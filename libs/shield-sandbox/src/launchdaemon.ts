/**
 * LaunchDaemon Management
 *
 * Creates and manages macOS LaunchDaemon for the broker.
 */

import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const PLIST_PATH = '/Library/LaunchDaemons/com.agenshield.broker.plist';
const LABEL = 'com.agenshield.broker';

/**
 * Generate the broker LaunchDaemon plist (with UserConfig)
 */
export function generateBrokerPlist(
  config: import('@agenshield/ipc').UserConfig,
  options?: {
    brokerPath?: string;
    configPath?: string;
    socketPath?: string;
  }
): string {
  const brokerBinary = options?.brokerPath || '/opt/agenshield/bin/agenshield-broker';
  const configPath = options?.configPath || '/opt/agenshield/config/shield.json';
  const socketPath = options?.socketPath || '/var/run/agenshield.sock';
  const brokerUsername = config.brokerUser.username;
  const socketGroupName = config.groups.socket.name;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${brokerBinary}</string>
    </array>

    <key>UserName</key>
    <string>${brokerUsername}</string>

    <key>GroupName</key>
    <string>${socketGroupName}</string>

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
    <string>/var/log/agenshield/broker.log</string>

    <key>StandardErrorPath</key>
    <string>/var/log/agenshield/broker.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENSHIELD_CONFIG</key>
        <string>${configPath}</string>
        <key>AGENSHIELD_SOCKET</key>
        <string>${socketPath}</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>/opt/agenshield</string>

    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>4096</integer>
    </dict>
</dict>
</plist>
`;
}

/**
 * Generate the broker LaunchDaemon plist (legacy - no UserConfig)
 */
export function generateBrokerPlistLegacy(options?: {
  brokerBinary?: string;
  configPath?: string;
  socketPath?: string;
}): string {
  const brokerBinary = options?.brokerBinary || '/opt/agenshield/bin/agenshield-broker';
  const configPath = options?.configPath || '/opt/agenshield/config/shield.json';
  const socketPath = options?.socketPath || '/var/run/agenshield.sock';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${brokerBinary}</string>
    </array>

    <key>UserName</key>
    <string>clawbroker</string>

    <key>GroupName</key>
    <string>clawshield</string>

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
    <string>/var/log/agenshield/broker.log</string>

    <key>StandardErrorPath</key>
    <string>/var/log/agenshield/broker.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENSHIELD_CONFIG</key>
        <string>${configPath}</string>
        <key>AGENSHIELD_SOCKET</key>
        <string>${socketPath}</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>/opt/agenshield</string>

    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>4096</integer>
    </dict>
</dict>
</plist>
`;
}

export interface DaemonResult {
  success: boolean;
  message: string;
  plistPath?: string;
  loaded?: boolean;
  error?: Error;
}

/**
 * Install the LaunchDaemon from plist content
 */
export async function installLaunchDaemon(plistContent: string): Promise<DaemonResult>;
/**
 * Install the LaunchDaemon with options (legacy)
 */
export async function installLaunchDaemon(options?: {
  brokerBinary?: string;
  configPath?: string;
  socketPath?: string;
}): Promise<DaemonResult>;
/**
 * Install the LaunchDaemon
 */
export async function installLaunchDaemon(
  plistOrOptions?: string | {
    brokerBinary?: string;
    configPath?: string;
    socketPath?: string;
  }
): Promise<DaemonResult> {
  let plistContent: string;

  if (typeof plistOrOptions === 'string') {
    plistContent = plistOrOptions;
  } else {
    plistContent = generateBrokerPlistLegacy(plistOrOptions);
  }

  try {
    // Write plist file
    await execAsync(`sudo tee "${PLIST_PATH}" > /dev/null << 'EOF'
${plistContent}
EOF`);

    // Set ownership and permissions
    await execAsync(`sudo chown root:wheel "${PLIST_PATH}"`);
    await execAsync(`sudo chmod 644 "${PLIST_PATH}"`);

    // Load the daemon
    await execAsync(`sudo launchctl load -w "${PLIST_PATH}"`);

    return {
      success: true,
      message: `LaunchDaemon installed at ${PLIST_PATH}`,
      plistPath: PLIST_PATH,
      loaded: true,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to install LaunchDaemon: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Load the LaunchDaemon
 */
export async function loadLaunchDaemon(): Promise<DaemonResult> {
  try {
    await execAsync(`sudo launchctl load -w "${PLIST_PATH}"`);

    return {
      success: true,
      message: 'LaunchDaemon loaded',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to load LaunchDaemon: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Unload the LaunchDaemon
 */
export async function unloadLaunchDaemon(): Promise<DaemonResult> {
  try {
    await execAsync(`sudo launchctl unload "${PLIST_PATH}"`);

    return {
      success: true,
      message: 'LaunchDaemon unloaded',
    };
  } catch (error) {
    // Might not be loaded
    if ((error as Error).message.includes('Could not find')) {
      return {
        success: true,
        message: 'LaunchDaemon was not loaded',
      };
    }

    return {
      success: false,
      message: `Failed to unload LaunchDaemon: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Uninstall the LaunchDaemon
 */
export async function uninstallLaunchDaemon(): Promise<DaemonResult> {
  try {
    // Unload first
    await unloadLaunchDaemon();

    // Remove plist file
    await execAsync(`sudo rm -f "${PLIST_PATH}"`);

    return {
      success: true,
      message: 'LaunchDaemon uninstalled',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to uninstall LaunchDaemon: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Check if LaunchDaemon is running
 */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`launchctl list | grep ${LABEL}`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get daemon status
 */
export async function getDaemonStatus(): Promise<{
  installed: boolean;
  running: boolean;
  pid?: number;
  lastExitStatus?: number;
}> {
  const status: {
    installed: boolean;
    running: boolean;
    pid?: number;
    lastExitStatus?: number;
  } = {
    installed: false,
    running: false,
  };

  // Check if plist exists
  try {
    await fs.access(PLIST_PATH);
    status.installed = true;
  } catch {
    return status;
  }

  // Check if running
  try {
    const { stdout } = await execAsync(`launchctl list ${LABEL} 2>/dev/null`);
    status.running = true;

    // Parse PID and exit status
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('PID')) {
        const match = line.match(/PID\s*=\s*(\d+)/);
        if (match) {
          status.pid = parseInt(match[1], 10);
        }
      }
      if (line.includes('LastExitStatus')) {
        const match = line.match(/LastExitStatus\s*=\s*(\d+)/);
        if (match) {
          status.lastExitStatus = parseInt(match[1], 10);
        }
      }
    }
  } catch {
    status.running = false;
  }

  return status;
}

/**
 * Restart the daemon
 */
export async function restartDaemon(): Promise<DaemonResult> {
  try {
    await unloadLaunchDaemon();
    await loadLaunchDaemon();

    return {
      success: true,
      message: 'LaunchDaemon restarted',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to restart LaunchDaemon: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}
