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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isSecretEnvVar } from '@agenshield/sandbox';
import { isOpenClawInstalled, stopOpenClawServices } from '@agenshield/integrations';
import { captureCallingUserEnv } from './sudo-env.js';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Daemon configuration
 */
export const DAEMON_CONFIG = {
  PID_FILE: '/var/run/agenshield/agenshield.pid',
  PORT: 5200,
  HOST: '127.0.0.1', // Use IPv4 for actual connections (avoids IPv6 issues)
  DISPLAY_HOST: 'localhost', // Use localhost for user-facing URLs
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
  // Check local installation first (~/.agenshield/dist/)
  const localDaemon = path.join(
    os.homedir(), '.agenshield', 'dist', 'node_modules',
    '@agenshield', 'daemon', 'dist', 'main.js',
  );
  if (fs.existsSync(localDaemon)) return localDaemon;

  // Try npm-installed package first (works when installed via npm)
  // Resolve bin path from package.json so it works both in monorepo (dist/main.js)
  // and when published (main.js directly in package root)
  try {
    const pkgPath = require.resolve('@agenshield/daemon/package.json');
    const pkgDir = path.dirname(pkgPath);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const binEntry = typeof pkg.bin === 'string'
      ? pkg.bin
      : pkg.bin?.['agenshield-daemon'] || './dist/main.js';
    const npmPath = path.resolve(pkgDir, binEntry);
    if (fs.existsSync(npmPath)) return npmPath;
  } catch {
    /* package not installed via npm */
  }

  const searchPaths = [
    // Monorepo: relative to CLI dist
    path.join(__dirname, '../../../shield-daemon/dist/main.js'),
    // System-installed location
    '/opt/agenshield/bin/agenshield-daemon',
    // Development from CWD
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
 * Check if a process is alive (handles EPERM for root-owned processes).
 * EPERM means the process exists but is owned by a different user.
 * ESRCH means the process does not exist.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
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
        if (!isNaN(pid) && isProcessAlive(pid)) {
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
  // Try regular user first
  try {
    const output = execSync(`lsof -ti :${port} -sTCP:LISTEN`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000,
    }).trim();
    if (output) {
      const pid = parseInt(output.split('\n')[0], 10);
      if (!isNaN(pid)) return pid;
    }
  } catch { /* lsof failed or no results */ }

  // Fallback: try with sudo (for root-owned daemons)
  try {
    const output = execSync(`sudo lsof -ti :${port} -sTCP:LISTEN`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    }).trim();
    if (output) {
      const pid = parseInt(output.split('\n')[0], 10);
      if (!isNaN(pid)) return pid;
    }
  } catch { /* sudo not available or failed */ }

  return null;
}

/**
 * Start the daemon
 */
export async function startDaemon(options: { foreground?: boolean; sudo?: boolean } = {}): Promise<{
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

  // Determine whether to prepend sudo to spawn commands
  const useSudo = options.sudo && (process.getuid?.() !== 0);

  if (options.foreground) {
    // Run in foreground (blocking)
    const spawnOpts: SpawnOptions = {
      stdio: 'inherit',
      env,
    };
    const child = useSudo
      ? spawn('sudo', ['-E', runner, daemonPath], spawnOpts)
      : spawn(runner, [daemonPath], spawnOpts);

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

    let daemonPid: number | undefined;

    if (useSudo) {
      // sudo credentials are session-scoped — detached: true creates a new
      // session via setsid() which loses the cached credentials. Use shell-
      // level backgrounding instead so sudo runs in the current session.
      // sudo -E preserves the environment from the execSync env option.
      fs.closeSync(logFd);

      const output = execSync(
        `sudo -E nohup "${runner}" "${daemonPath}" >> "${logFile}" 2>&1 & echo $!`,
        { encoding: 'utf-8', env, timeout: 15_000 },
      ).trim();
      const pid = parseInt(output, 10);
      if (!isNaN(pid)) daemonPid = pid;
    } else {
      const bgSpawnOpts: SpawnOptions = {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env,
      };
      const child = spawn(runner, [daemonPath], bgSpawnOpts);
      child.unref();
      daemonPid = child.pid;
    }

    // Write PID file
    if (daemonPid) {
      try {
        fs.writeFileSync(DAEMON_CONFIG.PID_FILE, String(daemonPid));
      } catch {
        // May require sudo
      }
    }

    // Wait a moment and verify
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const newStatus = await getDaemonStatus();

    if (newStatus.running) {
      return {
        success: true,
        message: 'Daemon started',
        pid: daemonPid,
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
 * Wait for a process to exit by polling `kill(pid, 0)`.
 * Returns true if the process exited within the timeout, false otherwise.
 */
async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

/**
 * Kill a process with SIGTERM, poll for exit, escalate to SIGKILL if needed.
 * Returns true if the process was successfully killed.
 */
async function killAndWait(pid: number): Promise<boolean> {
  // Send SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return true; // Already gone
    if (code === 'EPERM') {
      // Root-owned process — try sudo kill
      try {
        execSync(`sudo kill -15 ${pid}`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
      } catch {
        return false; // Can't signal
      }
    }
  }

  const exited = await waitForProcessExit(pid, 5000);
  if (exited) return true;

  // Escalate to SIGKILL
  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return true;
    if (code === 'EPERM') {
      try {
        execSync(`sudo kill -9 ${pid}`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
      } catch {
        return false;
      }
    }
  }

  return waitForProcessExit(pid, 2000);
}

/**
 * Discover all registered com.agenshield.* launchd labels.
 * Scans both user and system domains.
 */
function findRegisteredAgenshieldLabels(): string[] {
  const labels: string[] = [];

  // Check well-known labels explicitly first
  const KNOWN_LABELS = ['com.agenshield.daemon', 'com.agenshield.broker'];
  for (const label of KNOWN_LABELS) {
    try {
      execSync(`launchctl list ${label} 2>/dev/null`, { stdio: 'pipe' });
      labels.push(label);
    } catch { /* not registered */ }
  }

  // Scan for any additional com.agenshield.* labels (per-target brokers, etc.)
  try {
    const output = execSync('launchctl list 2>/dev/null', {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    });
    for (const line of output.split('\n')) {
      const match = line.match(/(com\.agenshield\.\S+)/);
      if (match && !labels.includes(match[1])) {
        labels.push(match[1]);
      }
    }
  } catch { /* launchctl list failed */ }

  // Also try sudo for system-domain labels invisible to regular user
  try {
    const output = execSync('sudo launchctl list 2>/dev/null', {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    });
    for (const line of output.split('\n')) {
      const match = line.match(/(com\.agenshield\.\S+)/);
      if (match && !labels.includes(match[1])) {
        labels.push(match[1]);
      }
    }
  } catch { /* sudo not available */ }

  return labels;
}

/**
 * Remove all com.agenshield.*.plist files from /Library/LaunchDaemons/.
 * Prevents launchd from respawning services on reboot.
 */
function cleanupAgenshieldPlists(): void {
  const plistDir = '/Library/LaunchDaemons';
  try {
    if (!fs.existsSync(plistDir)) return;
    const files = fs.readdirSync(plistDir);
    for (const file of files) {
      if (file.startsWith('com.agenshield.') && file.endsWith('.plist')) {
        const plistPath = path.join(plistDir, file);
        try {
          fs.unlinkSync(plistPath);
        } catch {
          // May need sudo
          try {
            execSync(`sudo rm -f ${JSON.stringify(plistPath)}`, {
              stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
            });
          } catch { /* best effort */ }
        }
      }
    }
  } catch { /* best effort */ }
}

/**
 * Remove all known PID files for the daemon.
 */
function cleanupAllPidFiles(): void {
  const homePidPath = path.join(os.homedir(), '.agenshield', 'daemon.pid');
  const legacyPidPath = DAEMON_CONFIG.PID_FILE;
  const pidPaths = [homePidPath, legacyPidPath];

  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser) {
    try {
      const userHome = execSync(`eval echo ~${sudoUser}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      }).trim();
      pidPaths.push(path.join(userHome, '.agenshield', 'daemon.pid'));
    } catch { /* ignore */ }
  }

  for (const p of pidPaths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

/**
 * Stop the daemon
 */
export async function stopDaemon(): Promise<{
  success: boolean;
  message: string;
}> {
  // Stop OpenClaw services first (they depend on broker)
  try {
    if (await isOpenClawInstalled()) {
      await stopOpenClawServices();
    }
  } catch {
    // Best effort
  }

  const status = await getDaemonStatus();

  if (!status.running) {
    return {
      success: true,
      message: 'Daemon is not running',
    };
  }

  // Try launchctl first — use bootout so KeepAlive can't respawn the job
  // Discover all registered com.agenshield.* labels (daemon, broker, per-target broker, etc.)
  const launchdLabels = findRegisteredAgenshieldLabels();
  let launchdStopped = false;

  for (const label of launchdLabels) {
    launchdStopped = true;
    try {
      execSync(`sudo launchctl bootout system/${label} 2>/dev/null`, { stdio: 'pipe' });
    } catch {
      try {
        execSync(`launchctl bootout gui/${process.getuid?.() ?? ''}/${label} 2>/dev/null`, { stdio: 'pipe' });
      } catch {
        try { execSync(`launchctl stop ${label}`, { stdio: 'pipe' }); } catch { /* ignore */ }
      }
    }
  }

  // Remove plist files from /Library/LaunchDaemons/ to prevent respawn on reboot
  cleanupAgenshieldPlists();

  if (launchdStopped) {
    // Even after launchctl bootout, wait for the actual process to exit
    if (status.pid) {
      await waitForProcessExit(status.pid, 5000);
    }

    cleanupAllPidFiles();

    // Verify the port is actually free
    const leftover = findDaemonPidByPort(DAEMON_CONFIG.PORT);
    if (leftover) {
      return {
        success: true,
        message: `Daemon stopped via launchd (PID ${status.pid}), but another process (PID ${leftover}) is still using port ${DAEMON_CONFIG.PORT}`,
      };
    }

    return {
      success: true,
      message: 'Daemon stopped via launchd',
    };
  }

  // Try killing by PID
  if (status.pid) {
    try {
      const killed = await killAndWait(status.pid);

      cleanupAllPidFiles();

      if (!killed) {
        return {
          success: false,
          message: `Failed to stop daemon (PID ${status.pid}): process did not exit after SIGKILL`,
        };
      }

      // Verify the port is free
      const leftover = findDaemonPidByPort(DAEMON_CONFIG.PORT);
      if (leftover) {
        return {
          success: true,
          message: `Daemon stopped (PID ${status.pid}), but another process (PID ${leftover}) is still using port ${DAEMON_CONFIG.PORT}`,
        };
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
      const killed = await killAndWait(portPid);

      cleanupAllPidFiles();

      if (!killed) {
        return {
          success: false,
          message: `Failed to stop daemon (PID ${portPid}): process did not exit after SIGKILL`,
        };
      }

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
