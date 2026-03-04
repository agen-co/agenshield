/**
 * AgenShield Menu Bar LaunchAgent Management
 *
 * Creates and manages a user-level macOS LaunchAgent for the AgenShield
 * menu bar app. Unlike the daemon LaunchDaemon (system-level, requires sudo),
 * this is a per-user LaunchAgent (no sudo required).
 *
 * Layout:
 *   App:    ~/.agenshield/apps/AgenShield.app
 *   Plist:  ~/Library/LaunchAgents/com.agenshield.menubar.plist
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// ─── Constants ───────────────────────────────────────────────────────────────

const MENUBAR_LABEL = 'com.agenshield.menubar';
const MENUBAR_PLIST_NAME = `${MENUBAR_LABEL}.plist`;

function getPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', MENUBAR_PLIST_NAME);
}

function getAppsDir(): string {
  return path.join(os.homedir(), '.agenshield', 'apps');
}

function getAppPath(): string {
  return path.join(getAppsDir(), 'AgenShield.app');
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MenuBarAgentResult {
  success: boolean;
  message: string;
  error?: Error;
}

export interface MenuBarAgentStatus {
  installed: boolean;
  running: boolean;
  pid?: number;
  label: string;
  appPath: string;
  plistPath: string;
}

// ─── Plist Generation ────────────────────────────────────────────────────────

export interface MenuBarAgentOptions {
  policyUrl?: string;
  orgName?: string;
}

/**
 * Generate the LaunchAgent plist for the menu bar app.
 */
function generateMenuBarPlist(options?: MenuBarAgentOptions): string {
  const appBinary = path.join(getAppPath(), 'Contents', 'MacOS', 'AgenShield');

  // Build EnvironmentVariables section if any options provided
  let envSection = '';
  const envEntries: string[] = [];
  if (options?.policyUrl) {
    envEntries.push(`        <key>AGENSHIELD_POLICY_URL</key>\n        <string>${options.policyUrl}</string>`);
  }
  if (options?.orgName) {
    envEntries.push(`        <key>AGENSHIELD_ORG_NAME</key>\n        <string>${options.orgName}</string>`);
  }
  if (envEntries.length > 0) {
    envSection = `
    <key>EnvironmentVariables</key>
    <dict>
${envEntries.join('\n')}
    </dict>
`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${MENUBAR_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${appBinary}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <false/>

    <key>ProcessType</key>
    <string>Interactive</string>

    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>
${envSection}</dict>
</plist>
`;
}

// ─── Installation ────────────────────────────────────────────────────────────

/**
 * Install the menu bar app as a user-level LaunchAgent.
 *
 * 1. Copies AgenShield.app to ~/.agenshield/apps/
 * 2. Writes LaunchAgent plist to ~/Library/LaunchAgents/
 * 3. Loads and starts the agent
 *
 * @param sourceAppPath - Path to the AgenShield.app bundle to install
 * @param options - Optional policy URL and org name to inject as environment variables
 */
export function installMenuBarAgent(sourceAppPath: string, options?: MenuBarAgentOptions): MenuBarAgentResult {
  try {
    const appsDir = getAppsDir();
    const destAppPath = getAppPath();

    // 1. Create apps directory
    fs.mkdirSync(appsDir, { recursive: true });

    // 2. Copy app bundle (skip if source is already at the destination)
    const resolvedSource = fs.realpathSync(sourceAppPath);
    const resolvedDest = fs.existsSync(destAppPath) ? fs.realpathSync(destAppPath) : null;
    if (resolvedSource !== resolvedDest) {
      if (resolvedDest) {
        fs.rmSync(destAppPath, { recursive: true, force: true });
      }
      execSync(`cp -R "${sourceAppPath}" "${destAppPath}"`, { stdio: 'pipe' });
    }

    // 3. Ensure LaunchAgents directory exists
    const launchAgentsDir = path.dirname(getPlistPath());
    fs.mkdirSync(launchAgentsDir, { recursive: true });

    // 4. Unload existing agent if present
    try {
      execSync(`launchctl bootout gui/$(id -u) "${getPlistPath()}" 2>/dev/null`, { stdio: 'pipe' });
    } catch { /* not loaded */ }

    // 5. Write plist
    fs.writeFileSync(getPlistPath(), generateMenuBarPlist(options));

    // 6. Load the agent
    execSync(`launchctl bootstrap gui/$(id -u) "${getPlistPath()}"`, { stdio: 'pipe' });

    return {
      success: true,
      message: 'Menu bar agent installed and launched',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to install menu bar agent: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

// ─── Uninstallation ─────────────────────────────────────────────────────────

/**
 * Uninstall the menu bar agent.
 * Stops the app, removes the LaunchAgent plist, and removes the app bundle.
 */
export function uninstallMenuBarAgent(): MenuBarAgentResult {
  try {
    // 1. Quit the app gracefully
    try {
      execSync(`launchctl bootout gui/$(id -u) "${getPlistPath()}" 2>/dev/null`, { stdio: 'pipe' });
    } catch { /* not loaded */ }

    // Also try to quit via AppleScript (graceful quit for running app)
    try {
      execSync(`osascript -e 'quit app "AgenShield"' 2>/dev/null`, { stdio: 'pipe' });
    } catch { /* not running */ }

    // Force-kill if still alive (osascript quit is unreliable)
    try {
      execSync('sleep 1 && killall AgenShield 2>/dev/null', { stdio: 'pipe' });
    } catch { /* not running */ }

    // 2. Remove plist
    try {
      fs.unlinkSync(getPlistPath());
    } catch { /* may not exist */ }

    // 3. Remove app bundle
    const appPath = getAppPath();
    if (fs.existsSync(appPath)) {
      fs.rmSync(appPath, { recursive: true, force: true });
    }

    return {
      success: true,
      message: 'Menu bar agent uninstalled',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to uninstall menu bar agent: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Get menu bar agent status.
 */
export function getMenuBarAgentStatus(): MenuBarAgentStatus {
  const status: MenuBarAgentStatus = {
    installed: false,
    running: false,
    label: MENUBAR_LABEL,
    appPath: getAppPath(),
    plistPath: getPlistPath(),
  };

  // Check if plist exists
  try {
    fs.accessSync(getPlistPath());
    status.installed = true;
  } catch {
    return status;
  }

  // Check if app exists
  if (!fs.existsSync(getAppPath())) {
    return status;
  }

  // Check if running
  try {
    const output = execSync(`launchctl list ${MENUBAR_LABEL} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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

// Export constants
export { MENUBAR_LABEL, MENUBAR_PLIST_NAME };
