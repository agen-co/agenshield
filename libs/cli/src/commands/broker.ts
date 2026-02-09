/**
 * Broker command
 *
 * Manages the AgenShield broker LaunchDaemon (start, stop, restart, status, logs).
 */

import { Command } from 'commander';
import {
  getDaemonStatus as getBrokerStatus,
  loadLaunchDaemon,
  unloadLaunchDaemon,
  restartDaemon as restartBroker,
  fixSocketPermissions,
} from '@agenshield/sandbox';

const BROKER_CONFIG = {
  PLIST: '/Library/LaunchDaemons/com.agenshield.broker.plist',
  SOCKET: '/var/run/agenshield/agenshield.sock',
  HTTP_PORT: 5201,
  HOST: 'localhost',
  LOG_FILE: '/var/log/agenshield/broker.log',
  ERROR_LOG_FILE: '/var/log/agenshield/broker.error.log',
};

/**
 * Show broker status
 */
async function showBrokerStatus(): Promise<void> {
  const status = await getBrokerStatus();

  console.log('AgenShield Broker Status');
  console.log('========================\n');

  if (!status.installed) {
    console.log('Status: \x1b[33m○ Not installed\x1b[0m');
    console.log(`\nPlist not found at ${BROKER_CONFIG.PLIST}`);
    console.log('Run "agenshield setup" to install the broker.');
    return;
  }

  if (status.running) {
    console.log('Status: \x1b[32m● Running\x1b[0m');
    if (status.pid) {
      console.log(`PID:    ${status.pid}`);
    }
    if (status.lastExitStatus !== undefined) {
      console.log(`Last exit: ${status.lastExitStatus}`);
    }
    console.log(`Socket: ${BROKER_CONFIG.SOCKET}`);
    console.log(`HTTP:   http://${BROKER_CONFIG.HOST}:${BROKER_CONFIG.HTTP_PORT}`);
  } else {
    console.log('Status: \x1b[31m○ Stopped\x1b[0m');
    if (status.lastExitStatus !== undefined) {
      console.log(`Last exit: ${status.lastExitStatus}`);
    }
    console.log(`\nPlist:  ${BROKER_CONFIG.PLIST}`);
  }
}

/**
 * Create the broker command with subcommands
 */
export function createBrokerCommand(): Command {
  const cmd = new Command('broker').description(
    'Manage the AgenShield broker (LaunchDaemon)'
  );

  // broker start
  cmd
    .command('start')
    .description('Start the broker (load LaunchDaemon)')
    .action(async () => {
      console.log('Starting AgenShield broker...');

      const result = await loadLaunchDaemon();

      if (result.success) {
        console.log(`\x1b[32m✓ ${result.message}\x1b[0m`);

        // Fix socket permissions so daemon can connect
        console.log('Fixing socket permissions...');
        const socketResult = await fixSocketPermissions();
        if (socketResult.success) {
          console.log(`\x1b[32m✓ ${socketResult.message}\x1b[0m`);
        } else {
          console.log(`\x1b[33m⚠ ${socketResult.message}\x1b[0m`);
        }

        console.log(`  Socket: ${BROKER_CONFIG.SOCKET}`);
        console.log(
          `  HTTP:   http://${BROKER_CONFIG.HOST}:${BROKER_CONFIG.HTTP_PORT}`
        );
      } else {
        console.log(`\x1b[31m✗ ${result.message}\x1b[0m`);
        process.exit(1);
      }
    });

  // broker stop
  cmd
    .command('stop')
    .description('Stop the broker (unload LaunchDaemon)')
    .action(async () => {
      console.log('Stopping AgenShield broker...');

      const result = await unloadLaunchDaemon();

      if (result.success) {
        console.log(`\x1b[32m✓ ${result.message}\x1b[0m`);
      } else {
        console.log(`\x1b[31m✗ ${result.message}\x1b[0m`);
        process.exit(1);
      }
    });

  // broker restart
  cmd
    .command('restart')
    .description('Restart the broker (unload + load LaunchDaemon)')
    .action(async () => {
      console.log('Restarting AgenShield broker...');

      const result = await restartBroker();

      if (result.success) {
        console.log(`\x1b[32m✓ ${result.message}\x1b[0m`);

        // Fix socket permissions after restart
        console.log('Fixing socket permissions...');
        const socketResult = await fixSocketPermissions();
        if (socketResult.success) {
          console.log(`\x1b[32m✓ ${socketResult.message}\x1b[0m`);
        } else {
          console.log(`\x1b[33m⚠ ${socketResult.message}\x1b[0m`);
        }

        console.log(`  Socket: ${BROKER_CONFIG.SOCKET}`);
        console.log(
          `  HTTP:   http://${BROKER_CONFIG.HOST}:${BROKER_CONFIG.HTTP_PORT}`
        );
      } else {
        console.log(`\x1b[31m✗ ${result.message}\x1b[0m`);
        process.exit(1);
      }
    });

  // broker status
  cmd
    .command('status')
    .description('Show broker status')
    .option('-j, --json', 'Output as JSON')
    .action(async (options) => {
      if (options.json) {
        const status = await getBrokerStatus();
        console.log(JSON.stringify(status, null, 2));
      } else {
        await showBrokerStatus();
      }
    });

  // broker logs
  cmd
    .command('logs')
    .description('Tail broker log file')
    .option('-e, --error', 'Show error log instead of stdout log')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .action(async (options) => {
      const { execSync } = await import('node:child_process');
      const logFile = options.error
        ? BROKER_CONFIG.ERROR_LOG_FILE
        : BROKER_CONFIG.LOG_FILE;
      const lines = options.lines;

      try {
        execSync(`tail -n ${lines} -f "${logFile}"`, { stdio: 'inherit' });
      } catch {
        // User interrupted with Ctrl+C — that's expected
      }
    });

  // Default action when no subcommand is provided
  cmd.action(async () => {
    await showBrokerStatus();
  });

  return cmd;
}
