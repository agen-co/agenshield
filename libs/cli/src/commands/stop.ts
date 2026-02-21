/**
 * Stop command
 *
 * Stops the AgenShield daemon.
 */

import { Command } from 'commander';
import { stopDaemon } from '../utils/daemon.js';

/**
 * Create the stop command
 */
export function createStopCommand(): Command {
  const cmd = new Command('stop')
    .description('Stop the AgenShield daemon')
    .action(async () => {
      console.log('Stopping AgenShield daemon...');

      const result = await stopDaemon();

      if (result.success) {
        console.log(`\x1b[32m✓ ${result.message}\x1b[0m`);
      } else {
        console.log(`\x1b[31m✗ ${result.message}\x1b[0m`);
        process.exit(1);
      }
    });

  return cmd;
}
