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
 *   Plist:  /Library/LaunchDaemons/com.agenshield.privilege-helper.plist
 *   Socket: ~/.agenshield/run/privilege-helper.sock
 *   Logs:   ~/.agenshield/logs/privilege-helper.log + .error.log
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  PRIVILEGE_HELPER_LAUNCHD_LABEL,
  PRIVILEGE_HELPER_LAUNCHD_PLIST,
  logDir,
  socketDir,
  privilegeHelperSocket,
} from '@agenshield/ipc';
import type { DaemonServiceConfig, DaemonServiceResult, DaemonServiceStatus } from './daemon-launchdaemon';

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
export function installPrivilegeHelperService(config: DaemonServiceConfig): DaemonServiceResult {
  const userHome = config.userHome || os.homedir();

  try {
    // 1. Create log directory (user-writable under ~/.agenshield/logs)
    const logsDir = logDir(userHome);
    fs.mkdirSync(logsDir, { recursive: true, mode: 0o755 });

    // 2. Ensure socket directory exists (~/.agenshield/run)
    const sockDir = socketDir(userHome);
    fs.mkdirSync(sockDir, { recursive: true, mode: 0o755 });

    // 3. Remove stale plist if exists
    try {
      execSync(`sudo launchctl bootout system/${PRIVILEGE_HELPER_LAUNCHD_LABEL} 2>/dev/null`, { stdio: 'pipe' });
    } catch { /* not loaded */ }

    // 4. Remove stale socket if exists
    const sockPath = privilegeHelperSocket(userHome);
    try {
      fs.unlinkSync(sockPath);
    } catch { /* may not exist */ }

    // 5. Write plist
    const plistContent = generatePrivilegeHelperPlist(config);
    const tmpPlist = `${os.tmpdir()}/com.agenshield.privilege-helper.plist`;
    fs.writeFileSync(tmpPlist, plistContent);
    execSync(`sudo cp "${tmpPlist}" "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`, { stdio: 'pipe' });
    execSync(`sudo chown root:wheel "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`, { stdio: 'pipe' });
    execSync(`sudo chmod 644 "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`, { stdio: 'pipe' });
    fs.unlinkSync(tmpPlist);

    // 6. Bootstrap the plist
    execSync(`sudo launchctl bootstrap system "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`, { stdio: 'pipe' });

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
export function startPrivilegeHelperService(): DaemonServiceResult {
  try {
    try {
      execSync(`sudo launchctl enable system/${PRIVILEGE_HELPER_LAUNCHD_LABEL}`, { stdio: 'pipe' });
    } catch { /* may already be enabled */ }

    execSync(`sudo launchctl kickstart system/${PRIVILEGE_HELPER_LAUNCHD_LABEL}`, { stdio: 'pipe' });

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
export function stopPrivilegeHelperService(): DaemonServiceResult {
  try {
    try {
      execSync(`sudo launchctl disable system/${PRIVILEGE_HELPER_LAUNCHD_LABEL}`, {
        stdio: 'pipe',
        timeout: 10_000,
      });
    } catch { /* may already be disabled */ }

    try {
      execSync(`sudo launchctl kill SIGTERM system/${PRIVILEGE_HELPER_LAUNCHD_LABEL}`, {
        stdio: 'pipe',
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
export function uninstallPrivilegeHelperService(userHome?: string): DaemonServiceResult {
  const home = userHome || os.homedir();

  try {
    // 1. Stop and unload
    try {
      execSync(`sudo launchctl bootout system/${PRIVILEGE_HELPER_LAUNCHD_LABEL} 2>/dev/null`, { stdio: 'pipe' });
    } catch { /* not loaded */ }

    // 2. Remove plist
    try {
      execSync(`sudo rm -f "${PRIVILEGE_HELPER_LAUNCHD_PLIST}"`, { stdio: 'pipe' });
    } catch { /* best effort */ }

    // 3. Remove socket
    try {
      fs.unlinkSync(privilegeHelperSocket(home));
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
export function getPrivilegeHelperServiceStatus(): DaemonServiceStatus {
  const status: DaemonServiceStatus = {
    installed: false,
    running: false,
    label: PRIVILEGE_HELPER_LAUNCHD_LABEL,
  };

  // Check if plist is installed
  try {
    fs.accessSync(PRIVILEGE_HELPER_LAUNCHD_PLIST);
    status.installed = true;
  } catch {
    return status;
  }

  // Check if service is running
  try {
    const output = execSync(`sudo launchctl list ${PRIVILEGE_HELPER_LAUNCHD_LABEL} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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
