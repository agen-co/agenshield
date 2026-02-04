/**
 * Daemon management utilities
 *
 * Provides functions for starting, stopping, and monitoring the AgenShield daemon.
 */

import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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
      return {
        running: true,
        port: DAEMON_CONFIG.PORT,
        uptime: data.uptime,
        url: `http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}`,
      };
    }
  } catch {
    // Daemon not responding via HTTP
  }

  // Check PID file
  try {
    if (fs.existsSync(DAEMON_CONFIG.PID_FILE)) {
      const pid = parseInt(fs.readFileSync(DAEMON_CONFIG.PID_FILE, 'utf8').trim(), 10);
      // Check if process is running
      try {
        process.kill(pid, 0);
        return { running: true, pid };
      } catch {
        // Process not running, stale PID file
        return { running: false };
      }
    }
  } catch {
    // PID file not accessible
  }

  return { running: false };
}

/**
 * Find the daemon executable path
 */
export function findDaemonExecutable(): string | null {
  const searchPaths = [
    // Relative to CLI dist
    path.join(__dirname, '../../../shield-daemon/dist/src/main.js'),
    // Installed location
    '/opt/agenshield/bin/agenshield-daemon',
    // Development location from project root
    path.join(process.cwd(), 'libs/shield-daemon/dist/src/main.js'),
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

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
  const daemonPath = findDaemonExecutable();
  if (!daemonPath) {
    return {
      success: false,
      message: 'Daemon executable not found. Build the daemon first: npm run build',
    };
  }

  const env = {
    ...process.env,
    AGENSHIELD_PORT: String(DAEMON_CONFIG.PORT),
    AGENSHIELD_HOST: DAEMON_CONFIG.HOST,
  };

  if (options.foreground) {
    // Run in foreground (blocking)
    const child = spawn('node', [daemonPath], {
      stdio: 'inherit',
      env,
    });

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

    // Ensure directories exist
    try {
      fs.mkdirSync(DAEMON_CONFIG.LOG_DIR, { recursive: true });
      fs.mkdirSync(DAEMON_CONFIG.SOCKET_DIR, { recursive: true });
    } catch {
      // May already exist or require sudo
    }

    const logFile = path.join(DAEMON_CONFIG.LOG_DIR, 'daemon.log');

    const child = spawn('node', [daemonPath], {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
      env,
    });

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
