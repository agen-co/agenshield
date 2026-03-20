/**
 * Service command — manage the AgenShield daemon as a system service.
 *
 * Commands:
 *   agenshield service install   — Install LaunchDaemon (macOS)
 *   agenshield service uninstall — Remove LaunchDaemon
 *   agenshield service status    — Show service status
 *   agenshield service restart   — Restart via launchctl
 */

import type { Command } from 'commander';
import { withGlobals } from './base.js';
import { ServiceError, PrivilegeError } from '../errors.js';
import { output } from '../utils/output.js';
import { findDaemonExecutable, DAEMON_CONFIG } from '../utils/daemon.js';
import { resolveHostHome } from '../utils/host-user.js';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  installDaemonService,
  uninstallDaemonService,
  startDaemonService,
  stopDaemonService,
  getDaemonServiceStatus,
  installPrivilegeHelperService,
  uninstallPrivilegeHelperService,
  startPrivilegeHelperService,
  stopPrivilegeHelperService,
  getPrivilegeHelperServiceStatus,
  installMenuBarAgent,
  uninstallMenuBarAgent,
  getMenuBarAgentStatus,
} from '@agenshield/seatbelt';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { AGENSHIELD_HOME } from '../utils/home.js';

export function registerServiceCommand(program: Command): void {
  const service = program
    .command('service')
    .description('Manage the AgenShield daemon as a system service (macOS LaunchDaemon)');

  // ── install ────────────────────────────────────────────────────────────
  service
    .command('install')
    .description('Install AgenShield daemon as a macOS LaunchDaemon')
    .option('--port <port>', 'Daemon HTTP port', String(DAEMON_CONFIG.PORT))
    .option('--host <host>', 'Daemon HTTP host', DAEMON_CONFIG.HOST)
    .action(withGlobals(async (opts) => {
      if (process.platform !== 'darwin') {
        throw new ServiceError(
          'LaunchDaemon service management is only supported on macOS. Linux systemd support is planned.',
          'install',
        );
      }

      const daemonPath = findDaemonExecutable();
      if (!daemonPath) {
        throw new ServiceError(
          'Daemon executable not found. Run `agenshield setup` first or build with `npx nx build shield-daemon`.',
          'install',
        );
      }

      output.info(`Installing daemon service (${daemonPath})...`);

      const hostHome = resolveHostHome();
      const result = await installDaemonService({
        daemonPath,
        port: Number(opts['port']) || DAEMON_CONFIG.PORT,
        host: (opts['host'] as string) || DAEMON_CONFIG.HOST,
        userHome: hostHome,
      });

      if (result.success) {
        output.success(result.message);

        // Also install privilege helper LaunchDaemon
        const helperResult = await installPrivilegeHelperService({
          daemonPath,
          port: Number(opts['port']) || DAEMON_CONFIG.PORT,
          host: (opts['host'] as string) || DAEMON_CONFIG.HOST,
          userHome: hostHome,
        });
        if (helperResult.success) {
          output.success(helperResult.message);
        } else {
          output.warn(`Privilege helper: ${helperResult.message}`);
        }

        output.info('The daemon will start automatically on boot.');
        output.info('Use `agenshield service status` to verify.');
      } else {
        if (result.message.includes('Operation not permitted')) {
          throw new PrivilegeError(
            'Installing a LaunchDaemon requires administrator privileges. Run with sudo.',
            'sudo agenshield service install',
          );
        }
        throw new ServiceError(result.message, 'install');
      }
    }));

  // ── uninstall ──────────────────────────────────────────────────────────
  service
    .command('uninstall')
    .description('Remove AgenShield LaunchDaemon (stops daemon and removes plist)')
    .action(withGlobals(async () => {
      if (process.platform !== 'darwin') {
        throw new ServiceError('LaunchDaemon service management is only supported on macOS.', 'uninstall');
      }

      output.info('Uninstalling services...');

      const result = await uninstallDaemonService();
      if (result.success) {
        output.success(result.message);
      } else {
        throw new ServiceError(result.message, 'uninstall');
      }

      // Also uninstall privilege helper
      const helperResult = await uninstallPrivilegeHelperService();
      if (helperResult.success) {
        output.success(helperResult.message);
      } else {
        output.warn(`Privilege helper: ${helperResult.message}`);
      }
    }));

  // ── status ─────────────────────────────────────────────────────────────
  service
    .command('status')
    .description('Show daemon LaunchDaemon service status')
    .action(withGlobals(async (opts) => {
      if (process.platform !== 'darwin') {
        throw new ServiceError('LaunchDaemon service management is only supported on macOS.', 'status');
      }

      const status = await getDaemonServiceStatus();
      const helperStatus = await getPrivilegeHelperServiceStatus();

      if (opts['json']) {
        output.data({ daemon: status, privilegeHelper: helperStatus });
        return;
      }

      output.info(`Service: ${status.label}`);
      output.info(`Installed: ${status.installed ? 'yes' : 'no'}`);
      if (status.installed) {
        output.info(`Running: ${status.running ? 'yes' : 'no'}`);
        if (status.pid) {
          output.info(`PID: ${status.pid}`);
        }
      }

      output.info('');
      output.info(`Service: ${helperStatus.label}`);
      output.info(`Installed: ${helperStatus.installed ? 'yes' : 'no'}`);
      if (helperStatus.installed) {
        output.info(`Running: ${helperStatus.running ? 'yes' : 'no'}`);
        if (helperStatus.pid) {
          output.info(`PID: ${helperStatus.pid}`);
        }
      }
    }));

  // ── restart ────────────────────────────────────────────────────────────
  service
    .command('restart')
    .description('Restart daemon via launchctl (stop + start)')
    .action(withGlobals(async () => {
      if (process.platform !== 'darwin') {
        throw new ServiceError('LaunchDaemon service management is only supported on macOS.', 'restart');
      }

      output.info('Restarting services...');

      const stopResult = await stopDaemonService();
      if (!stopResult.success) {
        output.warn(`Daemon stop: ${stopResult.message}`);
      }

      // Also restart privilege helper if installed
      const helperStatus = await getPrivilegeHelperServiceStatus();
      if (helperStatus.installed) {
        const helperStopResult = await stopPrivilegeHelperService();
        if (!helperStopResult.success) {
          output.warn(`Privilege helper stop: ${helperStopResult.message}`);
        }
      }

      // Brief pause before restart
      await new Promise(r => setTimeout(r, 1000));

      const startResult = await startDaemonService();
      if (startResult.success) {
        output.success('Daemon service restarted');
      } else {
        throw new ServiceError(startResult.message, 'restart');
      }

      if (helperStatus.installed) {
        const helperStartResult = await startPrivilegeHelperService();
        if (helperStartResult.success) {
          output.success('Privilege helper service restarted');
        } else {
          output.warn(`Privilege helper start: ${helperStartResult.message}`);
        }
      }
    }));

  // ── menubar ──────────────────────────────────────────────────────────
  const menubar = service
    .command('menubar')
    .description('Manage the AgenShield menu bar app (macOS LaunchAgent)');

  menubar
    .command('install')
    .description('Install menu bar app and LaunchAgent (auto-starts on login)')
    .action(withGlobals(async () => {
      if (process.platform !== 'darwin') {
        throw new ServiceError('Menu bar app is only supported on macOS.', 'menubar install');
      }

      // Find the AgenShield.app bundle
      const localApp = path.join(AGENSHIELD_HOME, 'apps', 'AgenShield.app');
      const systemApp = '/Applications/AgenShield.app';
      const sourceApp = fs.existsSync(localApp)
        ? localApp
        : fs.existsSync(systemApp)
          ? systemApp
          : null;

      if (!sourceApp) {
        throw new ServiceError(
          'AgenShield.app not found. Build it with `npx nx build shield-macos` or install it to /Applications.',
          'menubar install',
        );
      }

      output.info(`Installing menu bar app from ${sourceApp}...`);
      const result = await installMenuBarAgent(sourceApp);

      if (result.success) {
        output.success(result.message);
        output.info('The menu bar app will start automatically on login.');
      } else {
        throw new ServiceError(result.message, 'menubar install');
      }
    }));

  menubar
    .command('uninstall')
    .description('Remove menu bar LaunchAgent and app bundle')
    .action(withGlobals(async () => {
      if (process.platform !== 'darwin') {
        throw new ServiceError('Menu bar app is only supported on macOS.', 'menubar uninstall');
      }

      output.info('Uninstalling menu bar agent...');
      const result = await uninstallMenuBarAgent();

      if (result.success) {
        output.success(result.message);
      } else {
        throw new ServiceError(result.message, 'menubar uninstall');
      }
    }));

  menubar
    .command('status')
    .description('Show menu bar LaunchAgent status')
    .action(withGlobals(async (opts) => {
      if (process.platform !== 'darwin') {
        throw new ServiceError('Menu bar app is only supported on macOS.', 'menubar status');
      }

      const status = await getMenuBarAgentStatus();

      if (opts['json']) {
        output.data(status);
        return;
      }

      output.info(`Service: ${status.label}`);
      output.info(`Installed: ${status.installed ? 'yes' : 'no'}`);
      output.info(`App path: ${status.appPath}`);
      if (status.installed) {
        output.info(`Running: ${status.running ? 'yes' : 'no'}`);
        if (status.pid) {
          output.info(`PID: ${status.pid}`);
        }
      }
    }));
}
