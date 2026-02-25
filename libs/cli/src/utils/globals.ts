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

/**
 * Resolve global options from parsed Commander opts and the environment.
 */
export function resolveGlobalOptions(opts: Record<string, unknown>): GlobalOptions {
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
