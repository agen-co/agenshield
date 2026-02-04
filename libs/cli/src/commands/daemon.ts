/**
 * Daemon command
 *
 * Manages the AgenShield daemon (start, stop, restart, status).
 */

import { Command } from 'commander';
import { ensureRoot } from '../utils/privileges.js';
import {
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  DAEMON_CONFIG,
} from '../utils/daemon.js';

/**
 * Show daemon status
 */
async function showDaemonStatus(): Promise<void> {
  const status = await getDaemonStatus();

  console.log('AgenShield Daemon Status');
  console.log('========================\n');

  if (status.running) {
    console.log('Status: \x1b[32m● Running\x1b[0m');
    if (status.pid) {
      console.log(`PID:    ${status.pid}`);
    }
    if (status.port) {
      console.log(`Port:   ${status.port}`);
    }
    if (status.uptime) {
      console.log(`Uptime: ${status.uptime}`);
    }
    console.log(`URL:    http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}`);
  } else {
    console.log('Status: \x1b[31m○ Stopped\x1b[0m');
  }
}

/**
 * Create the daemon command with subcommands
 */
export function createDaemonCommand(): Command {
  const cmd = new Command('daemon').description('Manage the AgenShield daemon');

  // daemon start
  cmd
    .command('start')
    .description('Start the daemon')
    .option('-f, --foreground', 'Run in foreground (blocking)')
    .action(async (options) => {
      ensureRoot('daemon start');

      console.log('Starting AgenShield daemon...');

      const result = await startDaemon({ foreground: options.foreground });

      if (result.success) {
        console.log(`\x1b[32m✓ ${result.message}\x1b[0m`);
        if (result.pid) {
          console.log(`  PID: ${result.pid}`);
        }
        console.log(`  URL: http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}`);
      } else {
        console.log(`\x1b[31m✗ ${result.message}\x1b[0m`);
        process.exit(1);
      }
    });

  // daemon stop
  cmd
    .command('stop')
    .description('Stop the daemon')
    .action(async () => {
      ensureRoot('daemon stop');

      console.log('Stopping AgenShield daemon...');

      const result = await stopDaemon();

      if (result.success) {
        console.log(`\x1b[32m✓ ${result.message}\x1b[0m`);
      } else {
        console.log(`\x1b[31m✗ ${result.message}\x1b[0m`);
        process.exit(1);
      }
    });

  // daemon restart
  cmd
    .command('restart')
    .description('Restart the daemon')
    .action(async () => {
      ensureRoot('daemon restart');

      console.log('Restarting AgenShield daemon...');

      const result = await restartDaemon();

      if (result.success) {
        console.log(`\x1b[32m✓ ${result.message}\x1b[0m`);
      } else {
        console.log(`\x1b[31m✗ ${result.message}\x1b[0m`);
        process.exit(1);
      }
    });

  // daemon status (default action)
  cmd
    .command('status')
    .description('Show daemon status')
    .option('-j, --json', 'Output as JSON')
    .action(async (options) => {
      if (options.json) {
        const status = await getDaemonStatus();
        console.log(JSON.stringify(status, null, 2));
      } else {
        await showDaemonStatus();
      }
    });

  // Default action when no subcommand is provided
  cmd.action(async () => {
    await showDaemonStatus();
  });

  return cmd;
}
