/**
 * AgenShield Privilege Helper LaunchDaemon Management
 *
 * Creates and manages a macOS LaunchDaemon for the AgenShield privilege helper.
 * Follows the pattern established by daemon-launchdaemon.ts.
 *
 * The privilege helper runs as root via launchd, listening on a Unix socket
 * at ~/.agenshield/run/privilege-helper.sock. This eliminates the need for
 * osascript-based privilege escalation dialogs.
 *
 * Layout:
 *   Plist:  /Library/LaunchDaemons/com.frontegg.AgenShield.privilege-helper.plist
 *   Socket: ~/.agenshield/run/privilege-helper.sock
 *   Logs:   ~/.agenshield/logs/privilege-helper.log + .error.log
 */

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  PRIVILEGE_HELPER_LAUNCHD_LABEL,
  PRIVILEGE_HELPER_LAUNCHD_PLIST,
  logDir,
  socketDir,
  privilegeHelperSocket,
} from '@agenshield/ipc';
import type { DaemonServiceConfig, DaemonServiceResult, DaemonServiceStatus } from './daemon-launchdaemon';

const execAsync = promisify(exec);

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENSHIELD_HOST_BUNDLE_ID = 'com.frontegg.AgenShield';

// ─── Plist Generation ────────────────────────────────────────────────────────

/**
 * Generate the LaunchDaemon plist for the AgenShield privilege helper.
 *
 * Key differences from the daemon plist:
 * - No UserName key (runs as root by default for system LaunchDaemons)
 * - GroupName: staff (socket accessible to all macOS users)
 * - KeepAlive: true (unconditional — always available)
 * - ProgramArguments: [daemonPath, "--privilege-helper", socketPath]
 */
export function generatePrivilegeHelperPlist(config: DaemonServiceConfig): string {
  const userHome = config.userHome || os.homedir();
  const resolvedSocketPath = privilegeHelperSocket(userHome);
  const logs = logDir(userHome);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PRIVILEGE_HELPER_LAUNCHD_LABEL}</string>

    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>${AGENSHIELD_HOST_BUNDLE_ID}</string>
    </array>

    <key>ProgramArguments</key>
    <array>
        <string>${config.daemonPath}</string>
        <string>--privilege-helper</string>
        <string>${resolvedSocketPath}</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${userHome}</string>
        <key>AGENSHIELD_USER_HOME</key>
        <string>${userHome}</string>
    </dict>

    <key>GroupName</key>
    <string>staff</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>StandardOutPath</key>
    <string>${logs}/privilege-helper.log</string>

    <key>StandardErrorPath</key>
    <string>${logs}/privilege-helper.error.log</string>

    <key>WorkingDirectory</key>
    <string>/</string>
</dict>
</plist>
`;
}

// ─── Installation ────────────────────────────────────────────────────────────

/**
 * Install the AgenShield privilege helper as a macOS LaunchDaemon.
 */
export async function installPrivilegeHelperService(config: DaemonServiceConfig): Promise<DaemonServiceResult> {
  const userHome = config.userHome || os.homedir();

  try {
    // 1. Create log directory (user-writable under ~/.agenshield/logs)
    const logsDir = logDir(userHome);
    await fsp.mkdir(logsDir, { recursive: true, mode: 0o755 });

    // 2. Ensure socket directory exists (~/.agenshield/run)
    const sockDir = socketDir(userHome);
    await fsp.mkdir(sockDir, { recursive: true, mode: 0o755 });

    // 3. Remove stale service if loaded (including legacy label)
    try {
      await execAsync(`sudo launchctl bootout system/com.agenshield.privilege-helper 2>/dev/null`);
    } catch { /* not loaded */ }
    try {
      await execAsync(`sudo launchctl bootout system/${PRIVILEGE_HELPER_LAUNCHD_LABEL} 2>/dev/null`);
      await new Promise(r => setTimeout(r, 2000));
    } catch { /* not loaded */ }
    // Remove legacy plist if present
    try {
      await execAsync(`sudo rm -f "/Library/LaunchDaemons/com.agenshield.privilege-helper.plist"`);
    } catch { /* may not exist */ }

    // 4. Remove stale socket if exists
    const sockPath = privilegeHelperSocket(userHome);
    try {
      await fsp.unlink(sockPath);
    } catch { /* may not exist */ }

    // 5. Write plist
    const plistContent = generatePrivilegeHelperPlist(config);
    const tmpPlist = `${os.tmpdir()}/com.frontegg.AgenShield.privilege-helper.plist`;
    await fsp.writeFile(tmpPlist, plistContent);
    await execAsync(`sudo cp "${tmpPlist}" "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`);
    await execAsync(`sudo chown root:wheel "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`);
    await execAsync(`sudo chmod 644 "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`);
    // Strip provenance/quarantine xattrs — launchd refuses to bootstrap plists with these
    await execAsync(`sudo xattr -c "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`);
    await fsp.unlink(tmpPlist);

    // 6. Bootstrap with retry (launchd may still be unloading after bootout)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await execAsync(`sudo launchctl bootstrap system "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`);
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
      message: 'Privilege helper LaunchDaemon installed and loaded',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to install privilege helper service: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

// ─── Lifecycle Management ────────────────────────────────────────────────────

/**
 * Start the privilege helper via launchctl (enable + kickstart).
 */
export async function startPrivilegeHelperService(): Promise<DaemonServiceResult> {
  try {
    try {
      await execAsync(`sudo launchctl enable system/${PRIVILEGE_HELPER_LAUNCHD_LABEL}`);
    } catch { /* may already be enabled */ }

    await execAsync(`sudo launchctl kickstart system/${PRIVILEGE_HELPER_LAUNCHD_LABEL}`);

    return {
      success: true,
      message: 'Privilege helper started via launchd',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to start privilege helper service: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Stop the privilege helper via launchctl (disable + kill SIGTERM).
 * Keeps the plist — helper can be restarted.
 */
export async function stopPrivilegeHelperService(): Promise<DaemonServiceResult> {
  try {
    try {
      await execAsync(`sudo launchctl disable system/${PRIVILEGE_HELPER_LAUNCHD_LABEL}`, {
        timeout: 10_000,
      });
    } catch { /* may already be disabled */ }

    try {
      await execAsync(`sudo launchctl kill SIGTERM system/${PRIVILEGE_HELPER_LAUNCHD_LABEL}`, {
        timeout: 10_000,
      });
    } catch { /* may not be running */ }

    return {
      success: true,
      message: 'Privilege helper stopped via launchd (plist retained)',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to stop privilege helper service: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Uninstall the privilege helper service completely.
 * Bootouts the plist, removes files, and cleans up the socket.
 */
export async function uninstallPrivilegeHelperService(userHome?: string): Promise<DaemonServiceResult> {
  const home = userHome || os.homedir();

  try {
    // 1. Stop and unload
    try {
      await execAsync(`sudo launchctl bootout system/${PRIVILEGE_HELPER_LAUNCHD_LABEL} 2>/dev/null`);
    } catch { /* not loaded */ }

    // 2. Remove plist
    try {
      await execAsync(`sudo rm -f "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`);
    } catch { /* best effort */ }

    // 3. Remove socket
    try {
      await fsp.unlink(privilegeHelperSocket(home));
    } catch { /* may not exist */ }

    return {
      success: true,
      message: 'Privilege helper service uninstalled',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to uninstall privilege helper service: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

// ─── Status Checking ─────────────────────────────────────────────────────────

/**
 * Get privilege helper service status.
 */
export async function getPrivilegeHelperServiceStatus(): Promise<DaemonServiceStatus> {
  const status: DaemonServiceStatus = {
    installed: false,
    running: false,
    label: PRIVILEGE_HELPER_LAUNCHD_LABEL,
  };

  // Check if plist is installed
  try {
    await fsp.access(PRIVILEGE_HELPER_LAUNCHD_PLIST);
    status.installed = true;
  } catch {
    return status;
  }

  // Check if service is running
  try {
    const { stdout: output } = await execAsync(`sudo launchctl list ${PRIVILEGE_HELPER_LAUNCHD_LABEL} 2>/dev/null`);

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
