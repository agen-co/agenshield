/**
 * Commander.js global option wiring and centralized error handling.
 *
 * Replaces the former Clipanion BaseCommand class. Every command action
 * is wrapped with `withGlobals()` which resolves global options
 * (--json, --quiet, --no-color, --debug), configures the output module,
 * and catches errors through `handleError()`.
 */

import { Command } from 'commander';
import { resolveGlobalOptions } from '../utils/globals.js';
import { configureOutput } from '../utils/output.js';
import { CliError } from '../errors.js';

/**
 * Wrap a Commander action handler so that global options are resolved
 * and output is configured before the handler runs, and errors are
 * caught and formatted consistently.
 *
 * Commander passes `(opts, cmd)` for commands with no positional args,
 * or `(arg1, arg2, ..., opts, cmd)` when positional args are declared.
 * We always pull `cmd` from the last element and call `.optsWithGlobals()`.
 */
export function withGlobals(
  handler: (opts: Record<string, unknown>, cmd: Command) => Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    const globals = cmd.optsWithGlobals();
    configureOutput(resolveGlobalOptions(globals));
    try {
      await handler(args.length > 1 ? (args[args.length - 2] as Record<string, unknown>) : globals, cmd);
    } catch (err) {
      handleError(err, globals);
    }
  };
}

/**
 * Variant of `withGlobals` for commands that receive a single positional
 * argument before the options object.
 *
 * Commander calls the action as `(positionalArg, opts, cmd)`.
 */
export function withGlobalsPositional(
  handler: (positional: string, opts: Record<string, unknown>, cmd: Command) => Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    const opts = args[args.length - 2] as Record<string, unknown>;
    const positional = args[0] as string;
    const globals = cmd.optsWithGlobals();
    configureOutput(resolveGlobalOptions(globals));
    try {
      await handler(positional, opts, cmd);
    } catch (err) {
      handleError(err, globals);
    }
  };
}

/**
 * Central error handler — formats and exits per global flags.
 */
export function handleError(err: unknown, globals: { json?: boolean; debug?: boolean }): never {
  const error =
    err instanceof CliError
      ? err
      : new CliError(
          (err as Error).message ?? String(err),
          'UNKNOWN_ERROR',
        );

  if (globals.json) {
    process.stdout.write(JSON.stringify(error.toJSON(), null, 2) + '\n');
  } else {
    process.stderr.write(`\x1b[31m\u2717 ${error.message}\x1b[0m\n`);
    if (globals.debug && error.stack) {
      process.stderr.write(`\n${error.stack}\n`);
    }
  }

  process.exit(error.exitCode);
}
