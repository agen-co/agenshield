/**
 * Stop command
 *
 * Stops the AgenShield daemon.
 */

import type { Command } from 'commander';
import { withGlobals } from './base.js';
import { stopDaemon } from '../utils/daemon.js';
import { createSpinner } from '../utils/spinner.js';
import { CliError } from '../errors.js';

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the AgenShield daemon')
    .action(withGlobals(async () => {
      const spinner = await createSpinner('Stopping AgenShield daemon...');

      const result = await stopDaemon();

      if (result.success) {
        spinner.succeed(result.message);
      } else {
        spinner.fail(result.message);
        throw new CliError(result.message, 'DAEMON_STOP_FAILED');
      }
    }));
}
