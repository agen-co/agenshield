/**
 * Daemon management utilities
 *
 * Provides functions for starting, stopping, and monitoring the AgenShield daemon.
 */

import { spawn, execSync } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSecretEnvVar } from '@agenshield/sandbox';
import { captureCallingUserEnv } from './sudo-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Daemon configuration
 */
export const DAEMON_CONFIG = {
  PID_FILE: '/var/run/agenshield/agenshield.pid',
  PORT: 6969,
  HOST: 'localhost',
  LOG_DIR: '/var/log/agenshield',
  SOCKET_DIR: '/var/run/agenshield',
};

/**
 * Status of the daemon
 */
export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: string;
  url?: string;
}

/**
 * Get the current daemon status
 */
export async function getDaemonStatus(): Promise<DaemonStatus> {
  // Check via HTTP health endpoint first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = (await response.json()) as { uptime?: string };
      const pid = findDaemonPid() || findDaemonPidByPort(DAEMON_CONFIG.PORT);
      return {
        running: true,
        pid: pid ?? undefined,
        port: DAEMON_CONFIG.PORT,
        uptime: data.uptime,
        url: `http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}`,
      };
    }
  } catch {
    // Daemon not responding via HTTP
  }

  // Check PID files (home dir + legacy location)
  const pid = findDaemonPid();
  if (pid) {
    return { running: true, pid };
  }

  return { running: false };
}

/**
 * Find the daemon executable path
 */
export function findDaemonExecutable(): string | null {
  const searchPaths = [
    // Relative to CLI dist
    path.join(__dirname, '../../../shield-daemon/dist/main.js'),
    // Installed location
    '/opt/agenshield/bin/agenshield-daemon',
    // Development location from project root
    path.join(process.cwd(), 'libs/shield-daemon/dist/main.js'),
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Find the daemon TypeScript source (for tsx fallback in dev)
 */
export function findDaemonSource(): string | null {
  const searchPaths = [
    path.join(__dirname, '../../../shield-daemon/src/main.ts'),
    path.join(process.cwd(), 'libs/shield-daemon/src/main.ts'),
  ];
  return searchPaths.find(p => fs.existsSync(p)) || null;
}

/**
 * Find tsx binary for running TypeScript directly
 */
function findTsx(): string | null {
  const searchPaths = [
    path.join(process.cwd(), 'node_modules/.bin/tsx'),
  ];
  return searchPaths.find(p => fs.existsSync(p)) || null;
}

/**
 * Find daemon PID from known PID file locations
 */
function findDaemonPid(): number | null {
  const homePidPath = path.join(os.homedir(), '.agenshield', 'daemon.pid');
  const legacyPidPath = DAEMON_CONFIG.PID_FILE;
  const pidPaths = [homePidPath, legacyPidPath];

  // When running as root via sudo, the daemon runs as SUDO_USER and writes
  // its PID to ~sudouser/.agenshield/daemon.pid (not /var/root/).
  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser) {
    try {
      const userHome = execSync(`eval echo ~${sudoUser}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      }).trim();
      pidPaths.splice(1, 0, path.join(userHome, '.agenshield', 'daemon.pid'));
    } catch { /* ignore */ }
  }

  for (const pidPath of pidPaths) {
    try {
      if (fs.existsSync(pidPath)) {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
        if (!isNaN(pid)) {
          process.kill(pid, 0); // throws if not running
          return pid;
        }
      }
    } catch { /* stale or inaccessible */ }
  }
  return null;
}

/**
 * Find daemon PID by checking which process is listening on the daemon port
 */
function findDaemonPidByPort(port: number): number | null {
  try {
    const output = execSync(`lsof -ti :${port}`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000,
    }).trim();
    if (output) {
      const pid = parseInt(output.split('\n')[0], 10);
      if (!isNaN(pid)) return pid;
    }
  } catch { /* lsof failed */ }
  return null;
}

/**
 * Start the daemon
 */
export async function startDaemon(options: { foreground?: boolean } = {}): Promise<{
  success: boolean;
  message: string;
  pid?: number;
}> {
  // Check if already running
  const status = await getDaemonStatus();
  if (status.running) {
    return {
      success: true,
      message: 'Daemon is already running',
      pid: status.pid,
    };
  }

  // Find daemon executable
  let daemonPath = findDaemonExecutable();
  let runner = 'node';

  if (!daemonPath) {
    // Fallback: run from TypeScript source via tsx
    const source = findDaemonSource();
    const tsx = findTsx();
    if (source && tsx) {
      daemonPath = source;
      runner = tsx;
    } else {
      return {
        success: false,
        message: 'Daemon executable not found. Build first: npx nx build shield-daemon',
      };
    }
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    AGENSHIELD_PORT: String(DAEMON_CONFIG.PORT),
    AGENSHIELD_HOST: DAEMON_CONFIG.HOST,
  };

  const isUnderSudo = !!process.env['SUDO_USER'];

  if (isUnderSudo) {
    // Legacy path: running via "sudo agenshield daemon start"
    const userEnv = captureCallingUserEnv();
    if (userEnv) {
      const secretNames = Object.keys(userEnv).filter(k => userEnv[k] && isSecretEnvVar(k));
      if (secretNames.length > 0) {
        env['AGENSHIELD_USER_SECRETS'] = secretNames.join(',');
      }
      if (userEnv['PATH']) {
        env['PATH'] = userEnv['PATH'];
      }
    }
  } else {
    // User-mode: process.env already has correct PATH and secrets
    const secretNames = Object.keys(process.env).filter(
      k => process.env[k] && isSecretEnvVar(k)
    );
    if (secretNames.length > 0) {
      env['AGENSHIELD_USER_SECRETS'] = secretNames.join(',');
    }
  }

  // Ensure system dirs exist and are writable (daemon runs as root)
  for (const dir of [DAEMON_CONFIG.LOG_DIR, DAEMON_CONFIG.SOCKET_DIR]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // May already exist
    }
  }

  // Ensure user config dir
  const configDir = path.join(os.homedir(), '.agenshield');
  fs.mkdirSync(configDir, { recursive: true });

  if (options.foreground) {
    // Run in foreground (blocking)
    const spawnOpts: SpawnOptions = {
      stdio: 'inherit',
      env,
    };
    const child = spawn(runner, [daemonPath], spawnOpts);

    return new Promise((resolve) => {
      child.on('exit', (code) => {
        resolve({
          success: code === 0,
          message: code === 0 ? 'Daemon exited' : `Daemon exited with code ${code}`,
        });
      });
    });
  }

  // Run in background
  try {
    // Try launchctl first (macOS preferred)
    try {
      execSync('launchctl list com.agenshield.daemon 2>/dev/null', { stdio: 'pipe' });
      execSync('launchctl start com.agenshield.daemon');
      return {
        success: true,
        message: 'Daemon started via launchd',
      };
    } catch {
      // Not using launchd, fall back to nohup
    }

    let logDir = env['AGENSHIELD_LOG_DIR'] || DAEMON_CONFIG.LOG_DIR;
    let logFile = path.join(logDir, 'daemon.log');
    let logFd: number;
    try {
      logFd = fs.openSync(logFile, 'a');
    } catch {
      // File open failed — fall back to user-local log
      logDir = path.join(os.homedir(), '.agenshield', 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      logFile = path.join(logDir, 'daemon.log');
      logFd = fs.openSync(logFile, 'a');
    }

    const bgSpawnOpts: SpawnOptions = {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env,
    };
    const child = spawn(runner, [daemonPath], bgSpawnOpts);

    child.unref();

    // Write PID file
    try {
      fs.writeFileSync(DAEMON_CONFIG.PID_FILE, String(child.pid));
    } catch {
      // May require sudo
    }

    // Wait a moment and verify
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const newStatus = await getDaemonStatus();

    if (newStatus.running) {
      return {
        success: true,
        message: 'Daemon started',
        pid: child.pid,
      };
    } else {
      return {
        success: false,
        message: `Daemon failed to start. Check logs at ${logFile}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `Failed to start daemon: ${(err as Error).message}`,
    };
  }
}

/**
 * Stop the daemon
 */
export async function stopDaemon(): Promise<{
  success: boolean;
  message: string;
}> {
  const status = await getDaemonStatus();

  if (!status.running) {
    return {
      success: true,
      message: 'Daemon is not running',
    };
  }

  // Try launchctl first
  try {
    execSync('launchctl list com.agenshield.daemon 2>/dev/null', { stdio: 'pipe' });
    execSync('launchctl stop com.agenshield.daemon');
    return {
      success: true,
      message: 'Daemon stopped via launchd',
    };
  } catch {
    // Not using launchd
  }

  // Try killing by PID
  if (status.pid) {
    try {
      process.kill(status.pid, 'SIGTERM');

      // Wait for process to exit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Clean up PID file
      try {
        fs.unlinkSync(DAEMON_CONFIG.PID_FILE);
      } catch {
        // Ignore
      }

      return {
        success: true,
        message: `Daemon stopped (PID ${status.pid})`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to stop daemon: ${(err as Error).message}`,
      };
    }
  }

  // Fallback: find PID by port
  const portPid = findDaemonPidByPort(DAEMON_CONFIG.PORT);
  if (portPid) {
    try {
      process.kill(portPid, 'SIGTERM');
      await new Promise(r => setTimeout(r, 1000));
      return { success: true, message: `Daemon stopped (PID ${portPid}, via port lookup)` };
    } catch (err) {
      return { success: false, message: `Failed to stop daemon: ${(err as Error).message}` };
    }
  }

  return {
    success: false,
    message: 'Could not determine daemon PID. Try: pkill -f agenshield-daemon',
  };
}

/**
 * Restart the daemon
 */
export async function restartDaemon(): Promise<{
  success: boolean;
  message: string;
}> {
  const stopResult = await stopDaemon();
  if (!stopResult.success && stopResult.message !== 'Daemon is not running') {
    return stopResult;
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  const startResult = await startDaemon({ foreground: false });
  return startResult;
}
