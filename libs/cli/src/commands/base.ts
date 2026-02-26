/**
 * Abstract base command for all AgenShield CLI commands.
 *
 * Handles global options (--json, --quiet, --no-color, --debug),
 * configures the output module before execution, and provides
 * centralized error handling.
 */

import { Command, Option } from 'clipanion';
import { resolveGlobalOptions } from '../utils/globals.js';
import { configureOutput } from '../utils/output.js';
import { CliError } from '../errors.js';

export abstract class BaseCommand extends Command {
  json = Option.Boolean('--json', false, { description: 'Output machine-readable JSON' });
  quiet = Option.Boolean('-q,--quiet', false, { description: 'Suppress non-essential output' });
  noColor = Option.Boolean('--no-color', false, { description: 'Disable colors' });
  debug = Option.Boolean('--debug', false, { description: 'Show stack traces on errors' });

  /**
   * Subclasses implement their logic here.
   */
  abstract run(): Promise<number | void>;

  /**
   * Clipanion calls execute(). We wire up globals, then delegate to run().
   */
  async execute(): Promise<number | void> {
    this.configureGlobals();
    try {
      return await this.run();
    } catch (err) {
      return this.handleError(err);
    }
  }

  /**
   * Resolve global options and configure the output module.
   */
  protected configureGlobals(): void {
    const globalOpts = resolveGlobalOptions({
      json: this.json,
      quiet: this.quiet,
      noColor: this.noColor,
      debug: this.debug,
    });
    configureOutput(globalOpts);
  }

  /**
   * Central error handler — formats and exits per global flags.
   */
  protected handleError(err: unknown): never {
    const error =
      err instanceof CliError
        ? err
        : new CliError(
            (err as Error).message ?? String(err),
            'UNKNOWN_ERROR',
          );

    if (this.json) {
      process.stdout.write(JSON.stringify(error.toJSON(), null, 2) + '\n');
    } else {
      process.stderr.write(`\x1b[31m\u2717 ${error.message}\x1b[0m\n`);
      if (this.debug && error.stack) {
        process.stderr.write(`\n${error.stack}\n`);
      }
    }

    process.exit(error.exitCode);
  }
}
