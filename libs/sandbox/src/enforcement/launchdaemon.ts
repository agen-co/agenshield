/**
 * LaunchDaemon Management
 *
 * Creates and manages macOS LaunchDaemon for the broker.
 */

import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { generateBrokerPlistLegacy } from '../legacy.js';

const execAsync = promisify(exec);

const PLIST_PATH = '/Library/LaunchDaemons/com.agenshield.broker.plist';
const LABEL = 'com.agenshield.broker';
const AGENSHIELD_HOST_BUNDLE_ID = 'com.frontegg.AgenShieldES';

/**
 * Generate the broker LaunchDaemon plist (with UserConfig)
 */
export function generateBrokerPlist(
  config: import('@agenshield/ipc').UserConfig,
  options?: {
    baseName?: string;
    brokerPath?: string;
    configPath?: string;
    socketPath?: string;
    nodeBinPath?: string;
    logDir?: string;
    hostHome?: string;
    isSEABinary?: boolean;
    daemonUrl?: string;
    nativeModulePath?: string;
    /** Include AssociatedBundleIdentifiers block. Only set to true when /Applications/AgenShieldES.app exists. */
    includeAssociatedBundle?: boolean;
    /** Path to broker launcher shell script. When set, ProgramArguments uses /bin/bash + this path instead of the binary directly. */
    launcherScriptPath?: string;
  }
): string {
  const resolvedHostHome = options?.hostHome || process.env['HOME'] || '';
  const agentHome = config.agentUser.home;
  const sharedLibexecDir = resolvedHostHome ? `${resolvedHostHome}/.agenshield/libexec` : '/opt/agenshield/libexec';
  const nodeBinary = options?.nodeBinPath || `${agentHome}/bin/node-bin`;
  const brokerBinary = options?.brokerPath || `${sharedLibexecDir}/agenshield-broker`;
  const configPath = options?.configPath || `${agentHome}/.agenshield/config/shield.json`;
  const socketPath = options?.socketPath || `${agentHome}/.agenshield/run/agenshield.sock`;
  const brokerUsername = config.brokerUser.username;
  const socketGroupName = config.groups.socket.name;
  const label = options?.baseName ? `${LABEL}.${options.baseName}` : LABEL;
  const resolvedLogDir = options?.logDir ?? `${agentHome}/.agenshield/logs`;
  const associatedBundleBlock = options?.includeAssociatedBundle
    ? `
    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>${AGENSHIELD_HOST_BUNDLE_ID}</string>
    </array>
`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
${associatedBundleBlock}
    <key>ProgramArguments</key>
    <array>
${options?.launcherScriptPath
    ? `        <string>/bin/bash</string>\n        <string>${options.launcherScriptPath}</string>`
    : options?.isSEABinary
      ? `        <string>${brokerBinary}</string>`
      : `        <string>${nodeBinary}</string>\n        <string>${brokerBinary}</string>`}
    </array>

    <key>UserName</key>
    <string>${brokerUsername}</string>

    <key>GroupName</key>
    <string>${socketGroupName}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>ExitTimeOut</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${resolvedLogDir}/broker.log</string>

    <key>StandardErrorPath</key>
    <string>${resolvedLogDir}/broker.error.log</string>

    <!-- NOTE: Broker intentionally runs without NODE_OPTIONS/interceptor — it IS the
         enforcement point. If broker ever spawns Node.js as the agent user, add
         NODE_OPTIONS and AGENSHIELD_INTERCEPT_* here. -->
    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENSHIELD_CONFIG</key>
        <string>${configPath}</string>
        <key>AGENSHIELD_SOCKET</key>
        <string>${socketPath}</string>
        <key>AGENSHIELD_AGENT_HOME</key>
        <string>${config.agentUser.home}</string>
        <key>AGENSHIELD_HOST_HOME</key>
        <string>${resolvedHostHome}</string>
        <key>AGENSHIELD_AUDIT_LOG</key>
        <string>${resolvedLogDir}/audit.log</string>
        <key>AGENSHIELD_POLICIES</key>
        <string>${agentHome}/.agenshield/policies</string>
        <key>AGENSHIELD_LOG_DIR</key>
        <string>${resolvedLogDir}</string>
        <key>AGENSHIELD_PROFILE_ID</key>
        <string>${config.agentUser.username}</string>
        <key>AGENSHIELD_DAEMON_URL</key>
        <string>${options?.daemonUrl || 'http://127.0.0.1:5200'}</string>
        <key>AGENSHIELD_BROKER_HOME</key>
        <string>${config.agentUser.home}</string>
        <key>HOME</key>
        <string>${config.agentUser.home}</string>
        <key>NODE_ENV</key>
        <string>production</string>${options?.nativeModulePath ? `
        <key>BETTER_SQLITE3_BINDING</key>
        <string>${options.nativeModulePath}</string>` : ''}
    </dict>

    <key>WorkingDirectory</key>
    <string>${config.agentUser.home}</string>

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
 * Generate a broker launcher shell script that `exec`s the broker binary.
 * Using a shell wrapper avoids AMFI validation failures on macOS Sequoia
 * when bootstrapping SEA binaries as LaunchDaemons.
 */
export function generateBrokerLauncherScript(options: {
  brokerBinaryPath: string;
  configPath: string;
  socketPath: string;
  agentHome: string;
  hostHome: string;
  logDir: string;
  daemonUrl: string;
  profileId: string;
  nativeModulePath?: string;
}): string {
  return `#!/bin/bash
# AgenShield Broker Launcher
# Generated by agenshield shield. Do not edit manually.
# Wraps the SEA binary so launchctl bootstraps /bin/bash (Apple-signed)
# instead of the SEA binary directly, avoiding AMFI validation failures.
set -euo pipefail

export AGENSHIELD_CONFIG="${options.configPath}"
export AGENSHIELD_SOCKET="${options.socketPath}"
export AGENSHIELD_AGENT_HOME="${options.agentHome}"
export AGENSHIELD_HOST_HOME="${options.hostHome}"
export AGENSHIELD_AUDIT_LOG="${options.logDir}/audit.log"
export AGENSHIELD_POLICIES="${options.agentHome}/.agenshield/policies"
export AGENSHIELD_LOG_DIR="${options.logDir}"
export AGENSHIELD_PROFILE_ID="${options.profileId}"
export AGENSHIELD_DAEMON_URL="${options.daemonUrl}"
export AGENSHIELD_BROKER_HOME="${options.agentHome}"
export HOME="${options.agentHome}"
export NODE_ENV="production"${options.nativeModulePath ? `
export BETTER_SQLITE3_BINDING="${options.nativeModulePath}"` : ''}

exec "${options.brokerBinaryPath}"
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

    // Bootstrap the daemon (modern replacement for deprecated launchctl load)
    await execAsync(`sudo launchctl bootout system/${LABEL} 2>/dev/null; true`);
    await execAsync(`sudo launchctl bootstrap system "${PLIST_PATH}"`);

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
    await execAsync(`sudo launchctl bootout system/${LABEL} 2>/dev/null; true`);
    await execAsync(`sudo launchctl bootstrap system "${PLIST_PATH}"`);

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

/**
 * Fix socket permissions after broker starts
 * This ensures the daemon user can access the broker socket
 */
export async function fixSocketPermissions(
  config?: import('@agenshield/ipc').UserConfig,
  overrides?: { socketDir?: string; socketPath?: string },
): Promise<DaemonResult> {
  const agentHome = config?.agentUser?.home || '/Users/agenshield_agent';
  const socketDir = overrides?.socketDir || `${agentHome}/.agenshield/run`;
  const socketPath = overrides?.socketPath || `${socketDir}/agenshield.sock`;
  const brokerUsername = config?.brokerUser?.username || 'ash_default_broker';
  const socketGroupName = config?.groups?.socket?.name || 'ash_default';

  try {
    // Set directory permissions: 2770 (setgid + owner/group rwx)
    await execAsync(`sudo chmod 2770 "${socketDir}"`);

    // Wait for socket to be created (broker might still be starting)
    let socketFound = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await fs.access(socketPath);
        socketFound = true;
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!socketFound) {
      return {
        success: false,
        message: `Broker socket not created after 10s — check ${agentHome}/.agenshield/logs/broker.error.log`,
      };
    }

    // Set socket file permissions: 666 (world rw) — safe because Unix sockets are local-only
    // and the broker enforces authorization at the protocol level
    await execAsync(`sudo chmod 666 "${socketPath}"`);

    // Set socket ownership: broker user + socket group (allows group members to access)
    await execAsync(`sudo chown ${brokerUsername}:${socketGroupName} "${socketPath}"`);

    return {
      success: true,
      message: 'Socket permissions configured',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to fix socket permissions: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}
