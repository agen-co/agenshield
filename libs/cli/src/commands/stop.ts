/**
 * Stop command
 *
 * Stops the AgenShield daemon.
 */

import { Option } from 'clipanion';
import { BaseCommand } from './base.js';
import { stopDaemon } from '../utils/daemon.js';
import { output } from '../utils/output.js';
import { createSpinner } from '../utils/spinner.js';
import { CliError } from '../errors.js';

export class StopCommand extends BaseCommand {
  static override paths = [['stop']];

  static override usage = BaseCommand.Usage({
    category: 'Daemon',
    description: 'Stop the AgenShield daemon',
    examples: [['Stop the daemon', '$0 stop']],
  });

  async run(): Promise<number | void> {
    const spinner = await createSpinner('Stopping AgenShield daemon...');

    const result = await stopDaemon();

    if (result.success) {
      spinner.succeed(result.message);
    } else {
      spinner.fail(result.message);
      throw new CliError(result.message, 'DAEMON_STOP_FAILED');
    }
  }
}
