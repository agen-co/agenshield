/**
 * AgenShield Daemon LaunchDaemon Management
 *
 * Creates and manages a macOS LaunchDaemon for the AgenShield daemon process.
 * Follows the pattern established by openclaw-launchdaemon.ts but uses
 * modern launchctl subcommands (kickstart/disable instead of start/stop).
 *
 * The plist references the daemon binary directly (no shell wrapper) so that
 * macOS Login Items shows the code-signed binary identity instead of
 * "bash" / "unidentified developer".
 *
 * Layout:
 *   Plist:    /Library/LaunchDaemons/com.frontegg.AgenShield.daemon.plist
 *   Binary:   ~/.agenshield/libexec/agenshield-daemon
 *   Logs:     ~/.agenshield/logs/daemon.log + daemon.error.log
 */

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DAEMON_LAUNCHD_LABEL,
  DAEMON_LAUNCHD_PLIST,
  logDir,
} from '@agenshield/ipc';

const execAsync = promisify(exec);

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENSHIELD_HOST_BUNDLE_ID = 'com.frontegg.AgenShield';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DaemonServiceConfig {
  /** Path to the daemon binary (SEA) or script */
  daemonPath: string;
  /** HTTP port (default: 5200) */
  port?: number;
  /** HTTP host (default: 127.0.0.1) */
  host?: string;
  /** User home directory of the installing user */
  userHome?: string;
}

export interface DaemonServiceStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
  label: string;
}

export interface DaemonServiceResult {
  success: boolean;
  message: string;
  error?: Error;
}

// ─── Plist Generation ────────────────────────────────────────────────────────

/** @deprecated Legacy launcher script path — kept for uninstall cleanup. */
function getLauncherPath(userHome: string): string {
  return path.join(userHome, '.agenshield', 'bin', 'agenshield-daemon-launcher.sh');
}

/**
 * Resolve the owning user's username from the home path.
 * Falls back to the current user's name.
 */
function resolveUserName(userHome: string): string {
  // Extract username from /Users/<name> path
  const match = userHome.match(/^\/Users\/([^/]+)/);
  if (match) return match[1];
  return os.userInfo().username;
}

/**
 * Generate the LaunchDaemon plist for the AgenShield daemon.
 *
 * References the daemon binary directly in ProgramArguments (no shell wrapper)
 * so macOS Login Items shows the code-signed binary identity.
 * All environment variables previously set by the launcher script are now
 * declared in the plist's EnvironmentVariables dict.
 */
export function generateDaemonPlist(config: DaemonServiceConfig): string {
  const userHome = config.userHome || os.homedir();
  const port = config.port || 5200;
  const host = config.host || '127.0.0.1';
  const userName = resolveUserName(userHome);
  const envPath = `${userHome}/.local/bin:${userHome}/.agenshield/bin:${userHome}/.agenshield/libexec:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${DAEMON_LAUNCHD_LABEL}</string>

    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>${AGENSHIELD_HOST_BUNDLE_ID}</string>
    </array>

    <key>ProgramArguments</key>
    <array>
        <string>${config.daemonPath}</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${userHome}</string>
        <key>USER</key>
        <string>${userName}</string>
        <key>AGENSHIELD_USER_HOME</key>
        <string>${userHome}</string>
        <key>AGENSHIELD_PORT</key>
        <string>${port}</string>
        <key>AGENSHIELD_HOST</key>
        <string>${host}</string>
        <key>PATH</key>
        <string>${envPath}</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${logDir(userHome)}/daemon.log</string>

    <key>StandardErrorPath</key>
    <string>${logDir(userHome)}/daemon.error.log</string>

    <key>WorkingDirectory</key>
    <string>${userHome}/.agenshield</string>

    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>4096</integer>
    </dict>
</dict>
</plist>
`;
}

// ─── Installation ────────────────────────────────────────────────────────────

/**
 * Install the AgenShield daemon as a macOS LaunchDaemon.
 */
export async function installDaemonService(config: DaemonServiceConfig & { skipBootstrap?: boolean }): Promise<DaemonServiceResult> {
  const userHome = config.userHome || os.homedir();

  try {
    // 1. Create log directory (user-writable under ~/.agenshield/logs)
    const logsDir = logDir(userHome);
    await fsp.mkdir(logsDir, { recursive: true, mode: 0o755 });

    // 2. Remove legacy launcher script (replaced by direct binary reference in plist)
    const legacyLauncherPath = getLauncherPath(userHome);
    try { await fsp.unlink(legacyLauncherPath); } catch { /* may not exist */ }

    // 3. Remove stale service if loaded (including legacy label)
    if (!config.skipBootstrap) {
      try {
        await execAsync(`sudo launchctl bootout system/com.agenshield.daemon 2>/dev/null`);
      } catch { /* not loaded */ }
      try {
        await execAsync(`sudo launchctl bootout system/${DAEMON_LAUNCHD_LABEL} 2>/dev/null`);
        await new Promise(r => setTimeout(r, 2000));
      } catch { /* not loaded */ }
    }
    // Remove legacy plist if present
    try {
      await execAsync(`sudo rm -f "/Library/LaunchDaemons/com.agenshield.daemon.plist"`);
    } catch { /* may not exist */ }

    // 4. Write plist
    const plistContent = generateDaemonPlist(config);
    const tmpPlist = path.join(os.tmpdir(), 'com.frontegg.AgenShield.daemon.plist');
    await fsp.writeFile(tmpPlist, plistContent);
    await execAsync(`sudo cp "${tmpPlist}" "${DAEMON_LAUNCHD_PLIST}"`);
    await execAsync(`sudo chown root:wheel "${DAEMON_LAUNCHD_PLIST}"`);
    await execAsync(`sudo chmod 644 "${DAEMON_LAUNCHD_PLIST}"`);
    // Strip provenance/quarantine xattrs — launchd refuses to bootstrap plists with these
    await execAsync(`sudo xattr -c "${DAEMON_LAUNCHD_PLIST}"`);
    await fsp.unlink(tmpPlist);

    // When skipBootstrap is set, stop here — bootstrap is deferred to `agenshield start`
    if (config.skipBootstrap) {
      return {
        success: true,
        message: 'AgenShield daemon plist installed (bootstrap deferred)',
      };
    }

    // 5. Bootstrap with retry (launchd may still be unloading after bootout)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await execAsync(`sudo launchctl bootstrap system "${DAEMON_LAUNCHD_PLIST}"`);
        break;
      } catch (err) {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000));
        } else {
          throw err;
        }
      }
    }

    return {
      success: true,
      message: 'AgenShield daemon LaunchDaemon installed and loaded',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to install daemon service: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

// ─── Lifecycle Management ────────────────────────────────────────────────────

/**
 * Start the daemon via launchctl (enable + kickstart).
 * Does NOT remove the plist — safe for normal start.
 */
export async function startDaemonService(): Promise<DaemonServiceResult> {
  try {
    try {
      await execAsync(`sudo launchctl enable system/${DAEMON_LAUNCHD_LABEL}`);
    } catch { /* may already be enabled */ }

    await execAsync(`sudo launchctl kickstart system/${DAEMON_LAUNCHD_LABEL}`);

    return {
      success: true,
      message: 'Daemon started via launchd',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to start daemon service: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Stop the daemon via launchctl (disable + kill SIGTERM).
 * Keeps the plist — daemon can be restarted.
 */
export async function stopDaemonService(): Promise<DaemonServiceResult> {
  try {
    // Disable prevents KeepAlive from respawning
    try {
      await execAsync(`sudo launchctl disable system/${DAEMON_LAUNCHD_LABEL}`, {
        timeout: 10_000,
      });
    } catch { /* may already be disabled */ }

    // Send SIGTERM for graceful shutdown
    try {
      await execAsync(`sudo launchctl kill SIGTERM system/${DAEMON_LAUNCHD_LABEL}`, {
        timeout: 10_000,
      });
    } catch { /* may not be running */ }

    return {
      success: true,
      message: 'Daemon stopped via launchd (plist retained)',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to stop daemon service: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Uninstall the daemon service completely.
 * Bootouts the plist, removes files, and removes log rotation config.
 */
export async function uninstallDaemonService(userHome?: string): Promise<DaemonServiceResult> {
  const home = userHome || os.homedir();

  try {
    // 1. Stop and unload
    try {
      await execAsync(`sudo launchctl bootout system/${DAEMON_LAUNCHD_LABEL} 2>/dev/null`);
    } catch { /* not loaded */ }

    // 2. Remove plist
    try {
      await execAsync(`sudo rm -f "${DAEMON_LAUNCHD_PLIST}"`);
    } catch { /* best effort */ }

    // 3. Remove legacy launcher script (if it exists from older installs)
    const launcherPath = getLauncherPath(home);
    try {
      await fsp.unlink(launcherPath);
    } catch { /* may not exist */ }

    return {
      success: true,
      message: 'Daemon service uninstalled',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to uninstall daemon service: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

// ─── Status Checking ─────────────────────────────────────────────────────────

/**
 * Get daemon service status.
 */
export async function getDaemonServiceStatus(): Promise<DaemonServiceStatus> {
  const status: DaemonServiceStatus = {
    installed: false,
    running: false,
    label: DAEMON_LAUNCHD_LABEL,
  };

  // Check if plist is installed
  try {
    await fsp.access(DAEMON_LAUNCHD_PLIST);
    status.installed = true;
  } catch {
    return status;
  }

  // Check if service is running
  try {
    const { stdout: output } = await execAsync(`sudo launchctl list ${DAEMON_LAUNCHD_LABEL} 2>/dev/null`);

    // Parse PID from launchctl list output
    const pidMatch = output.match(/"?PID"?\s*[=:]\s*(\d+)/);
    if (pidMatch) {
      status.pid = parseInt(pidMatch[1], 10);
      status.running = true;
    }
  } catch {
    // Not loaded or not running
  }

  return status;
}
