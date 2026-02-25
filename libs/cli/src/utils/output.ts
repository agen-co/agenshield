/**
 * Centralized output formatting layer
 *
 * Replaces inline ANSI escape codes with helpers that respect:
 * - `--no-color` / `NO_COLOR` env / non-TTY stdout
 * - `--quiet` — suppress non-essential stderr messages
 * - `--json` — single JSON object to stdout, status messages suppressed
 *
 * Convention:
 *   stdout = data only (JSON, tokens, version strings)
 *   stderr = status messages, progress, errors
 */

import type { GlobalOptions } from './globals.js';

// ── ANSI helpers ──────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

// ── Module state (set once via `configure`) ───────────────────────────

let opts: GlobalOptions = {
  json: false,
  quiet: false,
  verbose: false,
  color: process.stdout.isTTY !== false && !process.env['NO_COLOR'],
  debug: false,
};

/**
 * Configure the output module with resolved global options.
 * Call once at CLI startup, before any command action runs.
 */
export function configureOutput(globalOpts: GlobalOptions): void {
  opts = globalOpts;
}

/**
 * Return the currently active global options.
 */
export function getOutputOptions(): Readonly<GlobalOptions> {
  return opts;
}

// ── Color wrappers ────────────────────────────────────────────────────

function colorize(color: string, text: string): string {
  return opts.color ? `${color}${text}${RESET}` : text;
}

// ── Public API ────────────────────────────────────────────────────────

export const output = {
  /**
   * Green checkmark + message to stderr.
   */
  success(msg: string): void {
    if (opts.json || opts.quiet) return;
    process.stderr.write(`${colorize(GREEN, '\u2713')} ${msg}\n`);
  },

  /**
   * Red X + message to stderr.
   */
  error(msg: string): void {
    if (opts.json) return;
    process.stderr.write(`${colorize(RED, '\u2717')} ${msg}\n`);
  },

  /**
   * Yellow warning + message to stderr.
   */
  warn(msg: string): void {
    if (opts.json || opts.quiet) return;
    process.stderr.write(`${colorize(YELLOW, '\u26A0')} ${msg}\n`);
  },

  /**
   * Plain informational message to stderr.
   */
  info(msg: string): void {
    if (opts.json || opts.quiet) return;
    process.stderr.write(`${msg}\n`);
  },

  /**
   * Verbose-only message to stderr (shown when --verbose).
   */
  verbose(msg: string): void {
    if (!opts.verbose || opts.json || opts.quiet) return;
    process.stderr.write(`${colorize(DIM, msg)}\n`);
  },

  /**
   * Data output: JSON to stdout when --json, formatted to stderr otherwise.
   */
  data(obj: unknown): void {
    if (opts.json) {
      process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    } else {
      process.stderr.write(JSON.stringify(obj, null, 2) + '\n');
    }
  },

  /**
   * Columnar table output: JSON array to stdout when --json,
   * formatted text to stderr otherwise.
   */
  table(rows: Record<string, unknown>[]): void {
    if (opts.json) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
      return;
    }
    if (rows.length === 0) return;
    const keys = Object.keys(rows[0]);
    const widths = keys.map((k) =>
      Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)),
    );
    const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ');
    const separator = widths.map((w) => '-'.repeat(w)).join('  ');
    process.stderr.write(`${header}\n${separator}\n`);
    for (const row of rows) {
      const line = keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  ');
      process.stderr.write(`${line}\n`);
    }
  },

  /**
   * Returns bold-styled string (or plain if no-color).
   */
  bold(msg: string): string {
    return colorize(BOLD, msg);
  },

  /**
   * Returns dim-styled string (or plain if no-color).
   */
  dim(msg: string): string {
    return colorize(DIM, msg);
  },

  /**
   * Returns cyan-styled string (or plain if no-color).
   */
  cyan(msg: string): string {
    return colorize(CYAN, msg);
  },

  /**
   * Returns green-styled string (or plain if no-color).
   */
  green(msg: string): string {
    return colorize(GREEN, msg);
  },

  /**
   * Returns red-styled string (or plain if no-color).
   */
  red(msg: string): string {
    return colorize(RED, msg);
  },

  /**
   * Returns yellow-styled string (or plain if no-color).
   */
  yellow(msg: string): string {
    return colorize(YELLOW, msg);
  },
};
