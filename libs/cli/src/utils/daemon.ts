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
import { isSEA } from '@agenshield/ipc';
import { isSecretEnvVar } from '@agenshield/sandbox';
import { isOpenClawInstalled, stopOpenClawServices } from '@agenshield/integrations';
import { captureCallingUserEnv } from './sudo-env.js';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Daemon configuration
 *
 * Respects AGENSHIELD_PORT and AGENSHIELD_HOST env vars for overrides.
 */
export const DAEMON_CONFIG = {
  PID_FILE: path.join(os.homedir(), '.agenshield', 'daemon.pid'),
  PORT: Number(process.env['AGENSHIELD_PORT']) || 5200,
  HOST: process.env['AGENSHIELD_HOST'] || '127.0.0.1', // Use IPv4 for actual connections (avoids IPv6 issues)
  DISPLAY_HOST: 'localhost', // Use localhost for user-facing URLs
  LOG_DIR: path.join(os.homedir(), '.agenshield', 'logs'),
  SOCKET_DIR: path.join(os.homedir(), '.agenshield', 'run'),
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
 * Find the daemon executable path.
 *
 * In multi-binary SEA mode, look for the separate `agenshield-daemon` binary
 * in `libexec/` relative to the CLI binary or in `~/.agenshield/libexec/`.
 */
export function findDaemonExecutable(): string | null {
  // Multi-binary SEA mode: look for agenshield-daemon in libexec/
  if (isSEA()) {
    const binDir = path.dirname(process.execPath);
    // Primary: ../libexec/ relative to bin/ (standard layout)
    const libexecBin = path.join(binDir, '..', 'libexec', 'agenshield-daemon');
    if (fs.existsSync(libexecBin)) return libexecBin;
    // Fallback: check ~/.agenshield/libexec/
    const homeLibexec = path.join(os.homedir(), '.agenshield', 'libexec', 'agenshield-daemon');
    if (fs.existsSync(homeLibexec)) return homeLibexec;
    // Legacy: alongside the CLI binary (pre-libexec layout)
    const legacyBin = path.join(binDir, 'agenshield-daemon');
    if (fs.existsSync(legacyBin)) return legacyBin;
    return null;
  }

  // Check local installation first (~/.agenshield/dist/)
  const localDaemonPkgPath = path.join(
    os.homedir(), '.agenshield', 'dist', 'node_modules',
    '@agenshield', 'daemon', 'package.json',
  );
  if (fs.existsSync(localDaemonPkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(localDaemonPkgPath, 'utf-8'));
      const binEntry = typeof pkg.bin === 'string'
        ? pkg.bin
        : pkg.bin?.['agenshield-daemon'] || './dist/main.js';
      const resolved = path.resolve(path.dirname(localDaemonPkgPath), binEntry);
      if (fs.existsSync(resolved)) return resolved;
    } catch { /* ignore */ }
  }

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
 * Fix ownership of config files that may have been created by a root-owned daemon.
 * When the daemon previously ran as root, it creates DB files under ~/.agenshield/
 * with root:0o600 permissions. A non-root daemon restart then fails with SQLITE_CANTOPEN.
 *
 * Returns true if files were fixed, false if no fix was needed.
 * Throws if the fix was needed but failed.
 */
function fixConfigOwnership(): boolean {
  const configDir = path.join(os.homedir(), '.agenshield');
  if (!fs.existsSync(configDir)) return false;

  const currentUid = process.getuid?.();
  if (currentUid === undefined || currentUid === 0) return false; // Running as root or unsupported platform

  // Check if any files in the config dir are root-owned
  const rootOwnedFiles: string[] = [];

  const dbFiles = ['agenshield.db', 'agenshield-activity.db'];
  for (const name of dbFiles) {
    const filePath = path.join(configDir, name);
    for (const suffix of ['', '-wal', '-shm']) {
      const fullPath = filePath + suffix;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.uid === 0) rootOwnedFiles.push(fullPath);
      } catch { /* file doesn't exist */ }
    }
  }

  // Also check other root-owned files (vault.enc, config.json, daemon.pid)
  for (const name of ['vault.enc', 'config.json', 'daemon.pid']) {
    const filePath = path.join(configDir, name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.uid === 0) rootOwnedFiles.push(filePath);
    } catch { /* ignore */ }
  }

  // Check directories that may contain root-owned content
  for (const dirName of ['skills', 'marketplace', 'logs']) {
    const dirPath = path.join(configDir, dirName);
    try {
      const stat = fs.statSync(dirPath);
      if (stat.uid === 0) rootOwnedFiles.push(dirPath);
    } catch { /* ignore */ }
  }

  if (rootOwnedFiles.length === 0) return false;

  const username = os.userInfo().username;
  try {
    execSync(`sudo chown -R ${username} "${configDir}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return true;
  } catch {
    console.error(
      `\n  \x1b[31m✗ Files in ${configDir} are owned by root and cannot be accessed.\x1b[0m\n` +
      `  Run manually: sudo chown -R ${username} "${configDir}"\n`
    );
    throw new Error(`Cannot fix root-owned files in ${configDir}. Run: sudo chown -R ${username} "${configDir}"`);
  }
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
 * Read the last N lines of a log file for diagnostics.
 * Returns empty string if the file is empty or unreadable.
 */
function readLogTail(logFile: string, maxLines = 20): string {
  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    if (!content.trim()) return '';
    const lines = content.trimEnd().split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
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
  let daemonArgs: string[] = [];

  // In multi-binary SEA mode, the daemon is a separate binary
  const seaMode = isSEA();
  if (seaMode && daemonPath) {
    runner = daemonPath;
    daemonArgs = [];
  } else if (!daemonPath) {
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

  // Fix ownership of files created by a previous root-owned daemon
  try {
    const fixed = fixConfigOwnership();
    if (fixed) {
      console.log('  Fixed ownership of root-owned config files.');
    }
  } catch {
    // Error already printed by fixConfigOwnership
  }

  // Determine whether to prepend sudo to spawn commands
  const useSudo = options.sudo && (process.getuid?.() !== 0);

  if (options.foreground) {
    // Run in foreground (blocking)
    const spawnOpts: SpawnOptions = {
      stdio: 'inherit',
      env,
    };
    const fgArgs = seaMode ? daemonArgs : [daemonPath!];
    const child = useSudo
      ? spawn('sudo', ['-E', runner, ...fgArgs], spawnOpts)
      : spawn(runner, fgArgs, spawnOpts);

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
    // Try launchctl first (macOS preferred) — use enable + kickstart (not deprecated start)
    try {
      execSync('launchctl list com.agenshield.daemon 2>/dev/null', { stdio: 'pipe' });
      try {
        execSync('sudo launchctl enable system/com.agenshield.daemon', { stdio: 'pipe' });
      } catch { /* may already be enabled */ }
      execSync('sudo launchctl kickstart system/com.agenshield.daemon', { stdio: 'pipe' });
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
    let earlyExit = false;
    let earlyExitCode: number | null = null;

    const bgArgs = seaMode ? daemonArgs : [daemonPath!];

    if (useSudo) {
      // sudo credentials are session-scoped — detached: true creates a new
      // session via setsid() which loses the cached credentials. Use shell-
      // level backgrounding instead so sudo runs in the current session.
      // sudo -E preserves the environment from the execSync env option.
      fs.closeSync(logFd);

      const argsStr = bgArgs.map(a => `"${a}"`).join(' ');
      const output = execSync(
        `sudo -E nohup "${runner}" ${argsStr} >> "${logFile}" 2>&1 & echo $!`,
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
      const child = spawn(runner, bgArgs, bgSpawnOpts);
      child.on('exit', (code) => { earlyExit = true; earlyExitCode = code; });
      child.unref();
      daemonPid = child.pid;
      fs.closeSync(logFd);
    }

    // Write PID file
    if (daemonPid) {
      try {
        fs.writeFileSync(DAEMON_CONFIG.PID_FILE, String(daemonPid));
      } catch {
        // May require sudo
      }
    }

    // Poll for daemon readiness instead of fixed 1s wait
    const deadline = Date.now() + 5000;
    let newStatus: DaemonStatus = { running: false };
    while (Date.now() < deadline) {
      if (earlyExit) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
      newStatus = await getDaemonStatus();
      if (newStatus.running) break;
    }

    if (newStatus.running) {
      return {
        success: true,
        message: 'Daemon started',
        pid: daemonPid,
      };
    } else {
      const tail = readLogTail(logFile);
      const parts: string[] = [];
      if (earlyExit) {
        parts.push(`Daemon process exited immediately${earlyExitCode !== null ? ` with code ${earlyExitCode}` : ''}.`);
      } else {
        parts.push('Daemon failed to start (health check timed out).');
      }
      if (tail) {
        parts.push(`\nLast log output (${logFile}):\n${tail}`);
      } else {
        parts.push(`\nLog file is empty: ${logFile}`);
        parts.push('Try running in foreground for full output: agenshield start --foreground');
      }
      return {
        success: false,
        message: parts.join('\n'),
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

  // Try launchctl first — use disable + kill SIGTERM (keeps plist, prevents KeepAlive respawn)
  // Discover all registered com.agenshield.* labels (daemon, broker, per-target broker, etc.)
  const launchdLabels = findRegisteredAgenshieldLabels();
  let launchdStopped = false;

  for (const label of launchdLabels) {
    launchdStopped = true;
    // Disable prevents KeepAlive from respawning — plist stays for restart
    try {
      execSync(`sudo launchctl disable system/${label}`, {
        stdio: 'pipe',
        timeout: 10_000,
      });
    } catch { /* may already be disabled or not in system domain */ }
    // Send SIGTERM for graceful shutdown
    try {
      execSync(`sudo launchctl kill SIGTERM system/${label}`, {
        stdio: 'pipe',
        timeout: 10_000,
      });
    } catch {
      // Fallback for user-domain services
      try {
        execSync(`launchctl kill SIGTERM gui/${process.getuid?.() ?? ''}/${label}`, { stdio: 'pipe' });
      } catch { /* not running */ }
    }
  }

  if (launchdStopped) {
    // Even after launchctl bootout, wait for the actual process to exit
    if (status.pid) {
      await waitForProcessExit(status.pid, 5000);
    }

    cleanupAllPidFiles();

    // Verify the port is actually free — kill leftover if needed
    const leftover = findDaemonPidByPort(DAEMON_CONFIG.PORT);
    if (leftover) {
      const killed = await killAndWait(leftover);
      if (!killed) {
        return {
          success: false,
          message: `Daemon stopped via launchd (PID ${status.pid}), but process ${leftover} is still using port ${DAEMON_CONFIG.PORT} and could not be killed`,
        };
      }
      const stillHeld = findDaemonPidByPort(DAEMON_CONFIG.PORT);
      if (stillHeld) {
        return {
          success: false,
          message: `Port ${DAEMON_CONFIG.PORT} still in use by PID ${stillHeld} after killing ${leftover}`,
        };
      }
      return {
        success: true,
        message: `Daemon stopped via launchd (killed leftover PID ${leftover})`,
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

      // Verify the port is free — kill leftover if needed
      const leftover = findDaemonPidByPort(DAEMON_CONFIG.PORT);
      if (leftover) {
        const leftoverKilled = await killAndWait(leftover);
        if (!leftoverKilled) {
          return {
            success: false,
            message: `Daemon stopped (PID ${status.pid}), but process ${leftover} is still using port ${DAEMON_CONFIG.PORT} and could not be killed`,
          };
        }
        const stillHeld = findDaemonPidByPort(DAEMON_CONFIG.PORT);
        if (stillHeld) {
          return {
            success: false,
            message: `Port ${DAEMON_CONFIG.PORT} still in use by PID ${stillHeld} after killing ${leftover}`,
          };
        }
        return {
          success: true,
          message: `Daemon stopped (PID ${status.pid}, killed leftover PID ${leftover})`,
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
 * Read the admin JWT token written by the daemon at startup.
 * Returns null if the file doesn't exist or can't be read.
 */
export function readAdminToken(): string | null {
  const paths = [
    path.join(os.homedir(), '.agenshield', '.admin-token'),
  ];
  for (const tokenPath of paths) {
    try {
      const token = fs.readFileSync(tokenPath, 'utf-8').trim();
      if (token) return token;
    } catch {
      // Not readable, try next
    }
  }
  return null;
}

/**
 * Fetch the admin JWT token from the daemon HTTP API.
 * Used as a fallback when the token file is not readable (e.g. non-root CLI).
 * The daemon runs as root and can issue tokens via POST /api/auth/admin-token.
 */
export async function fetchAdminToken(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      `http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}/api/auth/admin-token`,
      {
        method: 'POST',
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    if (!response.ok) {
      if (process.env['AGENSHIELD_DEBUG'] || process.env['DEBUG']) {
        const body = await response.text().catch(() => '');
        console.error(`[debug] fetchAdminToken: HTTP ${response.status} — ${body.slice(0, 200)}`);
      }
      return null;
    }

    const data = (await response.json()) as { success: boolean; token?: string };
    return data.success && data.token ? data.token : null;
  } catch (err) {
    if (process.env['AGENSHIELD_DEBUG'] || process.env['DEBUG']) {
      console.error(`[debug] fetchAdminToken: ${(err as Error).message}`);
    }
    return null;
  }
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
