/**
 * AgenShield Menu Bar LaunchAgent Management
 *
 * Creates and manages a user-level macOS LaunchAgent for the AgenShield
 * menu bar app. Unlike the daemon LaunchDaemon (system-level, requires sudo),
 * this is a per-user LaunchAgent (no sudo required).
 *
 * Layout:
 *   App:    ~/.agenshield/apps/AgenShield.app
 *   Plist:  ~/Library/LaunchAgents/com.frontegg.AgenShield.menubar.plist
 */

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ─── Constants ───────────────────────────────────────────────────────────────

const MENUBAR_LABEL = 'com.frontegg.AgenShield.menubar';
const MENUBAR_PLIST_NAME = `${MENUBAR_LABEL}.plist`;

function getPlistPath(home?: string): string {
  return path.join(home || os.homedir(), 'Library', 'LaunchAgents', MENUBAR_PLIST_NAME);
}

function getAppsDir(home?: string): string {
  return path.join(home || os.homedir(), '.agenshield', 'apps');
}

function getAppPath(home?: string): string {
  return path.join(getAppsDir(home), 'AgenShield.app');
}

/**
 * Resolve the UID for launchctl gui/ domain.
 * When running as root with a userHome override, resolve the target user's UID.
 */
async function resolveGuiUid(home?: string): Promise<string> {
  if (home && process.getuid?.() === 0) {
    const match = home.match(/\/Users\/([^/]+)/);
    if (match) {
      try {
        const { stdout } = await execAsync(`id -u ${match[1]}`, {
          timeout: 3_000,
        });
        return stdout.trim();
      } catch { /* fall through */ }
    }
  }
  return '$(id -u)';
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
  userHome?: string;
}

/**
 * Generate the LaunchAgent plist for the menu bar app.
 */
async function getEffectiveAppPath(home?: string): Promise<string> {
  const applicationsApp = '/Applications/AgenShield.app';
  const exists = await fsp.access(applicationsApp).then(() => true, () => false);
  if (exists) return applicationsApp;
  return getAppPath(home);
}

async function generateMenuBarPlist(options?: MenuBarAgentOptions): Promise<string> {
  const effectiveApp = await getEffectiveAppPath(options?.userHome);
  const appBinary = path.join(effectiveApp, 'Contents', 'MacOS', 'AgenShield');

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
export async function installMenuBarAgent(sourceAppPath: string, options?: MenuBarAgentOptions): Promise<MenuBarAgentResult> {
  try {
    const home = options?.userHome;
    const appsDir = getAppsDir(home);
    const destAppPath = getAppPath(home);
    const plistPath = getPlistPath(home);
    const uid = await resolveGuiUid(home);

    // 1. Create apps directory
    await fsp.mkdir(appsDir, { recursive: true });

    // 2. Copy app bundle (skip if source is already at the destination)
    const resolvedSource = await fsp.realpath(sourceAppPath);
    let resolvedDest: string | null = null;
    try {
      resolvedDest = await fsp.realpath(destAppPath);
    } catch { /* dest doesn't exist */ }
    if (resolvedSource !== resolvedDest) {
      if (resolvedDest) {
        await fsp.rm(destAppPath, { recursive: true, force: true });
      }
      await execAsync(`cp -R "${sourceAppPath}" "${destAppPath}"`);
    }

    // 3. Ensure LaunchAgents directory exists
    const launchAgentsDir = path.dirname(plistPath);
    await fsp.mkdir(launchAgentsDir, { recursive: true });

    // 4. Unload existing agent if present
    try {
      await execAsync(`launchctl bootout gui/${uid} "${plistPath}" 2>/dev/null`);
      // Give launchd time to fully unload the agent
      await new Promise(r => setTimeout(r, 2000));
    } catch { /* not loaded */ }

    // 5. Write plist
    const plistContent = await generateMenuBarPlist(options);
    await fsp.writeFile(plistPath, plistContent);
    // Strip provenance/quarantine xattrs — launchd refuses to bootstrap plists with these
    try {
      await execAsync(`xattr -c "${plistPath}"`);
    } catch { /* may not have xattrs */ }

    // 6. Load the agent with retry (launchd may still be unloading after bootout)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await execAsync(`launchctl bootstrap gui/${uid} "${plistPath}"`);
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
export async function uninstallMenuBarAgent(): Promise<MenuBarAgentResult> {
  try {
    // 1. Quit the app gracefully
    try {
      await execAsync(`launchctl bootout gui/$(id -u) "${getPlistPath()}" 2>/dev/null`);
    } catch { /* not loaded */ }

    // Also try to quit via AppleScript (graceful quit for running app)
    try {
      await execAsync(`osascript -e 'quit app "AgenShield"' 2>/dev/null`);
    } catch { /* not running */ }

    // Force-kill if still alive (osascript quit is unreliable)
    try {
      await new Promise(r => setTimeout(r, 1000));
      await execAsync('killall AgenShield 2>/dev/null');
    } catch { /* not running */ }

    // 2. Remove plist
    try {
      await fsp.unlink(getPlistPath());
    } catch { /* may not exist */ }

    // 3. Remove app bundle
    const appPath = getAppPath();
    const appExists = await fsp.access(appPath).then(() => true, () => false);
    if (appExists) {
      await fsp.rm(appPath, { recursive: true, force: true });
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
export async function getMenuBarAgentStatus(): Promise<MenuBarAgentStatus> {
  const status: MenuBarAgentStatus = {
    installed: false,
    running: false,
    label: MENUBAR_LABEL,
    appPath: getAppPath(),
    plistPath: getPlistPath(),
  };

  // Check if plist exists
  try {
    await fsp.access(getPlistPath());
    status.installed = true;
  } catch {
    return status;
  }

  // Check if app exists
  const appExists = await fsp.access(getAppPath()).then(() => true, () => false);
  if (!appExists) {
    return status;
  }

  // Check if running
  try {
    const { stdout: output } = await execAsync(`launchctl list ${MENUBAR_LABEL} 2>/dev/null`);

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
