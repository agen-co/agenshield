/**
 * Process Manager
 *
 * Manages gateway child processes directly instead of relying on launchd.
 * The daemon (running as root) spawns gateway processes as the agent user
 * via `sudo -u <agentUsername>`.
 *
 * Features:
 * - PID tracking and status monitoring
 * - Auto-restart with crash guard (max 5 restarts in 300s)
 * - Clean shutdown with SIGTERM → SIGKILL escalation
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { emitProcessStarted, emitProcessStopped, emitProcessRestarted } from '../events/emitter';
import { getLogger } from '../logger';

export interface ManagedProcess {
  targetId: string;
  profileId: string;
  command: string;
  runAsUser: string;
  pid: number | null;
  status: 'running' | 'stopped' | 'crashed';
  startedAt: number;
  restartCount: number;
  env: Record<string, string>;
  gatewayPort?: number;
}

export interface SpawnConfig {
  targetId: string;
  profileId: string;
  command: string;
  runAsUser: string;
  agentHome: string;
  env?: Record<string, string>;
  gatewayPort?: number;
}

interface InternalProcess extends ManagedProcess {
  childProcess: ChildProcess | null;
  crashTimestamps: number[];
}

const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 300_000; // 5 minutes
const SIGTERM_TIMEOUT_MS = 10_000;

export class ProcessManager {
  private processes = new Map<string, InternalProcess>();

  /**
   * Spawn a managed process as the agent user.
   */
  spawn(config: SpawnConfig): ManagedProcess {
    const existing = this.processes.get(config.targetId);
    if (existing?.status === 'running' && existing.childProcess) {
      getLogger().warn(`Process already running for target ${config.targetId} (pid=${existing.pid})`);
      return this.toPublic(existing);
    }

    const proc = this.doSpawn(config, existing?.crashTimestamps ?? []);
    return this.toPublic(proc);
  }

  /**
   * Stop a managed process. Sends SIGTERM, then SIGKILL after timeout.
   */
  async stop(targetId: string): Promise<void> {
    const proc = this.processes.get(targetId);
    if (!proc || !proc.childProcess || proc.status !== 'running') {
      return;
    }

    await this.doStop(proc);
    emitProcessStopped('gateway', { pid: proc.pid ?? undefined }, proc.profileId);
  }

  /**
   * Restart a managed process (stop + spawn).
   */
  async restart(targetId: string): Promise<ManagedProcess | null> {
    const proc = this.processes.get(targetId);
    if (!proc) return null;

    const config: SpawnConfig = {
      targetId: proc.targetId,
      profileId: proc.profileId,
      command: proc.command,
      runAsUser: proc.runAsUser,
      agentHome: proc.env['HOME'] ?? '',
      env: proc.env,
      gatewayPort: proc.gatewayPort,
    };

    if (proc.status === 'running' && proc.childProcess) {
      await this.doStop(proc);
    }

    const newProc = this.doSpawn(config, []);
    return this.toPublic(newProc);
  }

  /**
   * Get status for a specific target.
   */
  getStatus(targetId: string): ManagedProcess | null {
    const proc = this.processes.get(targetId);
    return proc ? this.toPublic(proc) : null;
  }

  /**
   * Get all managed processes.
   */
  getAll(): ManagedProcess[] {
    return Array.from(this.processes.values()).map((p) => this.toPublic(p));
  }

  /**
   * Stop all managed processes (called on daemon shutdown).
   */
  async shutdown(): Promise<void> {
    const stops = Array.from(this.processes.values())
      .filter((p) => p.status === 'running' && p.childProcess)
      .map((p) => this.doStop(p));
    await Promise.all(stops);
    this.processes.clear();
  }

  private doSpawn(config: SpawnConfig, existingCrashTimestamps: number[]): InternalProcess {
    const { targetId, profileId, command, runAsUser, agentHome, env = {}, gatewayPort } = config;

    // Build shell command that sources NVM and runs the gateway
    const nvmSh = `${agentHome}/.nvm/nvm.sh`;
    const shellCmd = [
      `source "${nvmSh}" 2>/dev/null || true`,
      command,
    ].join(' && ');

    const fullEnv: Record<string, string> = {
      HOME: agentHome,
      NVM_DIR: `${agentHome}/.nvm`,
      ...env,
    };

    // Build env string for sudo
    const envStr = Object.entries(fullEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');

    const child = spawn('sudo', ['-u', runAsUser, 'bash', '-c', `${envStr} bash -c '${shellCmd.replace(/'/g, "'\\''")}'`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const proc: InternalProcess = {
      targetId,
      profileId,
      command,
      runAsUser,
      pid: child.pid ?? null,
      childProcess: child,
      status: 'running',
      startedAt: Date.now(),
      restartCount: existingCrashTimestamps.length,
      env: fullEnv,
      gatewayPort,
      crashTimestamps: existingCrashTimestamps,
    };

    this.processes.set(targetId, proc);

    // Log stdout/stderr to gateway log file
    const logDir = `${agentHome}/.agenshield/logs`;
    try {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logStream = fs.createWriteStream(`${logDir}/gateway.log`, { flags: 'a' });
      const errStream = fs.createWriteStream(`${logDir}/gateway.error.log`, { flags: 'a' });
      child.stdout?.pipe(logStream);
      child.stderr?.pipe(errStream);
    } catch {
      // Best-effort logging
    }

    getLogger().info(`[ProcessManager] Spawned gateway for ${targetId} (pid=${child.pid}, user=${runAsUser})`);
    emitProcessStarted('gateway', { pid: child.pid }, profileId);

    // Handle exit for auto-restart
    child.on('exit', (code, signal) => {
      getLogger().info(`[ProcessManager] Gateway exited for ${targetId} (code=${code}, signal=${signal})`);
      proc.childProcess = null;

      if (proc.status === 'stopped') {
        // Intentional stop — don't restart
        return;
      }

      proc.status = 'crashed';

      // Crash guard: track timestamps within the window
      const now = Date.now();
      proc.crashTimestamps.push(now);
      proc.crashTimestamps = proc.crashTimestamps.filter(
        (ts) => now - ts < CRASH_WINDOW_MS,
      );

      if (proc.crashTimestamps.length >= MAX_CRASHES) {
        getLogger().error(`[ProcessManager] Gateway for ${targetId} crashed ${MAX_CRASHES} times in ${CRASH_WINDOW_MS / 1000}s — halting restart loop`);
        emitProcessStopped('gateway', { pid: proc.pid ?? undefined, lastExitStatus: code ?? undefined }, proc.profileId);
        return;
      }

      // Auto-restart after a brief delay
      const delay = Math.min(proc.crashTimestamps.length * 5000, 30_000);
      getLogger().info(`[ProcessManager] Auto-restarting gateway for ${targetId} in ${delay}ms (restart #${proc.crashTimestamps.length})`);
      setTimeout(() => {
        if (proc.status === 'stopped') return; // Stop was called during delay
        const previousPid = proc.pid;
        const newProc = this.doSpawn(config, proc.crashTimestamps);
        newProc.restartCount = proc.crashTimestamps.length;
        emitProcessRestarted('gateway', { pid: newProc.pid ?? undefined, previousPid: previousPid ?? undefined }, profileId);
      }, delay);
    });

    child.on('error', (err) => {
      getLogger().error(`[ProcessManager] Spawn error for ${targetId}: ${err.message}`);
      proc.status = 'crashed';
      proc.childProcess = null;
    });

    return proc;
  }

  private async doStop(proc: InternalProcess): Promise<void> {
    if (!proc.childProcess) {
      proc.status = 'stopped';
      return;
    }

    proc.status = 'stopped';
    const child = proc.childProcess;
    proc.childProcess = null;

    return new Promise<void>((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      child.on('exit', cleanup);

      // Send SIGTERM
      try {
        child.kill('SIGTERM');
      } catch {
        // Process may already be dead
        cleanup();
        return;
      }

      // Escalate to SIGKILL after timeout
      setTimeout(() => {
        if (!resolved) {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already dead
          }
          cleanup();
        }
      }, SIGTERM_TIMEOUT_MS);
    });
  }

  private toPublic(proc: InternalProcess): ManagedProcess {
    return {
      targetId: proc.targetId,
      profileId: proc.profileId,
      command: proc.command,
      runAsUser: proc.runAsUser,
      pid: proc.pid,
      status: proc.status,
      startedAt: proc.startedAt,
      restartCount: proc.restartCount,
      env: proc.env,
      gatewayPort: proc.gatewayPort,
    };
  }
}
