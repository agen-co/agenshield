/**
 * Global CLI options — resolved once at startup, shared across all commands.
 */

export interface GlobalOptions {
  /** Output machine-readable JSON to stdout */
  json: boolean;
  /** Suppress non-essential output */
  quiet: boolean;
  /** Show detailed output */
  verbose: boolean;
  /** Whether colors are enabled (respects --no-color, NO_COLOR, TTY) */
  color: boolean;
  /** Show stack traces on errors */
  debug: boolean;
}

export interface RawGlobalFlags {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  noColor?: boolean;
  debug?: boolean;
}

/**
 * Resolve global options from parsed flags and the environment.
 * Accepts either a typed flags object (from BaseCommand) or
 * a generic record (legacy Commander usage).
 */
export function resolveGlobalOptions(opts: RawGlobalFlags | Record<string, unknown>): GlobalOptions {
  const noColor =
    !!opts['noColor'] ||
    !!process.env['NO_COLOR'] ||
    process.stdout.isTTY === false;

  return {
    json: !!opts['json'],
    quiet: !!opts['quiet'],
    verbose: !!opts['verbose'],
    color: !noColor,
    debug: !!opts['debug'],
  };
}
