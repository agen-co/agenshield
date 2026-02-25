/**
 * Stop command
 *
 * Stops the AgenShield daemon.
 */

import { Command } from 'commander';
import { stopDaemon } from '../utils/daemon.js';
import { output } from '../utils/output.js';
import { CliError } from '../errors.js';

/**
 * Create the stop command
 */
export function createStopCommand(): Command {
  const cmd = new Command('stop')
    .description('Stop the AgenShield daemon')
    .action(async () => {
      output.info('Stopping AgenShield daemon...');

      const result = await stopDaemon();

      if (result.success) {
        output.success(result.message);
      } else {
        throw new CliError(result.message, 'DAEMON_STOP_FAILED');
      }
    });

  return cmd;
}
