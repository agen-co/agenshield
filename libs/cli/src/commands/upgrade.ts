/**
 * Upgrade command
 *
 * Stops the daemon, runs the update flow, then restarts the daemon.
 * Convenience wrapper that combines stop + update + start.
 */

import { Command } from 'commander';
import { stopDaemon, startDaemon, getDaemonStatus, DAEMON_CONFIG } from '../utils/daemon.js';
import { runUpdate } from './update.js';

/**
 * Create the upgrade command
 */
export function createUpgradeCommand(): Command {
  const cmd = new Command('upgrade')
    .description('Upgrade AgenShield (stop, update, restart)')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('-v, --verbose', 'Show verbose output')
    .option('--force', 'Re-apply even if already at latest version')
    .option('--cli', 'Use terminal mode instead of web browser')
    .action(async (options) => {
      const wasDaemonRunning = (await getDaemonStatus()).running;

      // Stop daemon before upgrade
      if (wasDaemonRunning && !options.dryRun) {
        console.log('Stopping daemon before upgrade...');
        const stopResult = await stopDaemon();
        if (!stopResult.success && stopResult.message !== 'Daemon is not running') {
          console.log(`\x1b[31m✗ ${stopResult.message}\x1b[0m`);
          process.exit(1);
        }
        console.log(`\x1b[32m✓ ${stopResult.message}\x1b[0m`);
        console.log('');
      }

      // Run the update logic (reuses the full update engine)
      await runUpdate({
        dryRun: options.dryRun,
        verbose: options.verbose,
        force: options.force,
        cli: options.cli,
      });

      // Restart daemon after upgrade (update engine may have already started it,
      // so check first)
      if (!options.dryRun) {
        const status = await getDaemonStatus();
        if (!status.running) {
          console.log('Restarting daemon...');
          const startResult = await startDaemon();
          if (startResult.success) {
            const url = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
            console.log(`\x1b[32m✓ ${startResult.message}\x1b[0m`);
            console.log(`  URL: ${url}`);
          } else {
            console.log(`\x1b[31m✗ ${startResult.message}\x1b[0m`);
          }
        }
      }
    });

  return cmd;
}
