/**
 * Start command
 *
 * Starts the AgenShield daemon. On first run after install, auto-installs
 * macOS services (LaunchDaemon, privilege helper, menu bar agent).
 */

import type { Command } from 'commander';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { withGlobals } from './base.js';
import {
  getDaemonStatus,
  startDaemon,
  DAEMON_CONFIG,
  findDaemonExecutable,
} from '../utils/daemon.js';
import { AGENSHIELD_HOME } from '../utils/home.js';
import { resolveHostHome } from '../utils/host-user.js';
import { waitForAdminToken } from '../utils/browser.js';
import { ensureSudoAccess, startSudoKeepalive } from '../utils/privileges.js';
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { createSpinner } from '../utils/spinner.js';
import { DaemonStartError } from '../errors.js';

/**
 * Check if AgenShield.app is already running as a process.
 * Catches the case where `agenshield install` launched the app via `open`
 * but the LaunchAgent hasn't been bootstrapped yet.
 */
function isAgenShieldAppRunning(): boolean {
  try {
    execSync('pgrep -x AgenShield', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Bootstrap macOS services on `agenshield start`.
 *
 * Plists are written by `agenshield install` (with skipBootstrap).
 * This function bootstraps them via launchctl so they actually run.
 *
 * The daemon plist is written but NOT bootstrapped here — `startDaemon()` handles
 * daemon startup, avoiding duplicate bootstrap / I/O errors from launchd.
 *
 * If plists are missing (older install), falls back to full install+bootstrap.
 */
async function autoInstallMacOSServices(): Promise<void> {
  try {
    const { getDaemonServiceStatus, installDaemonService,
            installPrivilegeHelperService, installMenuBarAgent,
            getMenuBarAgentStatus } = await import('@agenshield/seatbelt');

    const serviceStatus = await getDaemonServiceStatus();
    if (serviceStatus.running) return; // Already bootstrapped and running

    const daemonPath = findDaemonExecutable();
    const hostHome = resolveHostHome();

    // Check for pending-services.json written by install (deferred privileged ops)
    const pendingPath = path.join(AGENSHIELD_HOME, 'pending-services.json');
    let pending: { copyApp?: boolean; installPlists?: boolean; claudeSystemWrapper?: boolean } | null = null;
    try {
      if (fs.existsSync(pendingPath)) {
        pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
      }
    } catch { /* ignore malformed */ }

    // Perform deferred privileged operations from install
    if (pending) {
      output.info('  Completing deferred install operations...');

      // Copy .app to /Applications/
      if (pending.copyApp) {
        const menuBarAppPath = path.join(AGENSHIELD_HOME, 'apps', 'AgenShield.app');
        if (fs.existsSync(menuBarAppPath) && !fs.existsSync('/Applications/AgenShield.app')) {
          try {
            execSync(`sudo cp -R "${menuBarAppPath}" /Applications/AgenShield.app`, {
              encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
            });
            execSync(`sudo chown -R root:wheel /Applications/AgenShield.app`, {
              encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
            });
            output.success('Copied AgenShield.app to /Applications/');
          } catch {
            output.warn('Could not copy AgenShield.app to /Applications/');
          }
        }
      }

      // Install Claude wrapper to /usr/local/bin/claude
      if (pending.claudeSystemWrapper) {
        try {
          const { installClaudeWrapper } = await import('../utils/claude-wrapper.js');
          const wrapperResult = installClaudeWrapper();
          if (wrapperResult.installed.length > 0) {
            output.success(`Installed Claude launcher → ${wrapperResult.installed.join(', ')}`);
          }
        } catch {
          output.warn('Could not install Claude wrapper to /usr/local/bin/');
        }
      }

      // Remove pending manifest after processing
      try { fs.unlinkSync(pendingPath); } catch { /* best effort */ }
    }

    if (!serviceStatus.installed) {
      // Plists not written yet — do full install (write + bootstrap)
      output.info('  Installing macOS services (first run)...');

      // Copy .app if not present (fallback if pending didn't handle it)
      if (!pending?.copyApp) {
        const menuBarAppPath = path.join(AGENSHIELD_HOME, 'apps', 'AgenShield.app');
        if (fs.existsSync(menuBarAppPath) && !fs.existsSync('/Applications/AgenShield.app')) {
          try {
            execSync(`sudo cp -R "${menuBarAppPath}" /Applications/AgenShield.app`, {
              encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
            });
            execSync(`sudo chown -R root:wheel /Applications/AgenShield.app`, {
              encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
            });
            output.success('Copied AgenShield.app to /Applications/');
          } catch {
            output.warn('Could not copy AgenShield.app to /Applications/');
          }
        }
      }

      if (daemonPath) {
        // Write daemon plist but skip bootstrap — startDaemon() handles it
        const dr = await installDaemonService({ daemonPath, userHome: hostHome, skipBootstrap: true });
        if (dr.success) output.success('Installed LaunchDaemon plist');
        else output.warn(`LaunchDaemon install: ${dr.message}`);

        const hr = await installPrivilegeHelperService({ daemonPath, userHome: hostHome });
        if (hr.success) output.success('Installed privilege helper service');
        else output.warn(`Privilege helper install: ${hr.message}`);
      }

      // Menu bar agent — skip if app is already running (prevents duplicate icon)
      const appPath = fs.existsSync('/Applications/AgenShield.app')
        ? '/Applications/AgenShield.app'
        : path.join(AGENSHIELD_HOME, 'apps', 'AgenShield.app');
      if (fs.existsSync(appPath)) {
        const menuBarStatus = await getMenuBarAgentStatus();
        if (!menuBarStatus.running && !isAgenShieldAppRunning()) {
          const mr = await installMenuBarAgent(appPath, { userHome: hostHome });
          if (mr.success) output.success('Installed menu bar agent');
          else output.warn(`Menu bar agent: ${mr.message}`);
        }
      }
    } else {
      // Plists exist (written by install) — bootstrap non-daemon services
      output.info('  Bootstrapping macOS services...');

      if (daemonPath) {
        // Write/update daemon plist but skip bootstrap — startDaemon() handles it
        const dr = await installDaemonService({ daemonPath, userHome: hostHome, skipBootstrap: true });
        if (dr.success) output.success('Updated LaunchDaemon plist');
        else output.warn(`LaunchDaemon plist: ${dr.message}`);

        const hr = await installPrivilegeHelperService({ daemonPath, userHome: hostHome });
        if (hr.success) output.success('Bootstrapped privilege helper service');
        else output.warn(`Privilege helper bootstrap: ${hr.message}`);
      }

      // Menu bar agent — skip if app is already running (prevents duplicate icon)
      const menuBarStatus = await getMenuBarAgentStatus();
      if (!menuBarStatus.running && !isAgenShieldAppRunning()) {
        const appPath = fs.existsSync('/Applications/AgenShield.app')
          ? '/Applications/AgenShield.app'
          : path.join(AGENSHIELD_HOME, 'apps', 'AgenShield.app');
        if (fs.existsSync(appPath)) {
          const mr = await installMenuBarAgent(appPath, { userHome: hostHome });
          if (mr.success) output.success('Bootstrapped menu bar agent');
          else output.warn(`Menu bar agent bootstrap: ${mr.message}`);
        }
      }
    }

    output.info('');
  } catch (err) {
    output.warn(`Auto-install services failed: ${(err as Error).message}`);
    output.info('  You can install services manually: sudo agenshield service install');
  }
}

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the AgenShield daemon (requires setup)')
    .option('-f, --foreground', 'Run in foreground (blocking)', false)
    .option('--seed-policies <path>', 'Seed managed policies from a JSON file on start')
    .action(withGlobals(async (opts) => {
      ensureSetupComplete();
      const status = await getDaemonStatus();

      if (status.running) {
        output.success(`Daemon is already running (PID: ${status.pid ?? 'unknown'})`);
        output.info('');
        return;
      }

      // Auto-install macOS services on first run after install.
      // The signed SEA binary is trusted by SentinelOne, so plist writes succeed.
      if (os.platform() === 'darwin') {
        await autoInstallMacOSServices();
      }

      // Ensure sudo credentials are cached before spawning the daemon
      ensureSudoAccess();

      let sudoKeepalive: NodeJS.Timeout | undefined;
      if (opts['foreground']) {
        sudoKeepalive = startSudoKeepalive();
      }

      const spinner = await createSpinner('Starting AgenShield daemon...');
      const result = await startDaemon({ foreground: opts['foreground'] as boolean, sudo: true });

      if (sudoKeepalive) {
        clearInterval(sudoKeepalive);
      }

      if (result.success) {
        spinner.succeed(`${result.message}${result.pid ? ` (PID: ${result.pid})` : ''}`);

        // Seed managed policies from file if provided
        if (opts['seedPolicies']) {
          const token = await waitForAdminToken();
          await seedManagedPolicies(opts['seedPolicies'] as string, token);
        }

        output.info('');
      } else {
        spinner.fail('Failed to start daemon');
        output.info('');
        output.info(result.message);
        output.info('');
        throw new DaemonStartError('Daemon failed to start');
      }
    }));
}

/**
 * Seed managed policies from a JSON file into the running daemon.
 * POSTs to /api/config/policies/managed/sync.
 */
async function seedManagedPolicies(filePath: string, token: string | null): Promise<void> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    // Expect { source?: string, policies: PolicyConfig[] } or PolicyConfig[]
    const body = Array.isArray(data)
      ? { source: 'seed', policies: data }
      : { source: data.source ?? 'seed', policies: data.policies };

    if (!Array.isArray(body.policies)) {
      output.warn('Seed file must contain a policies array');
      return;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(
      `http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}/api/config/policies/managed/sync`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
    );

    if (res.ok) {
      output.success(`Seeded ${body.policies.length} managed policies from ${filePath}`);
    } else {
      const text = await res.text();
      output.warn(`Failed to seed policies: ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (err) {
    output.warn(`Failed to read or seed policies from ${filePath}: ${(err as Error).message}`);
  }
}
