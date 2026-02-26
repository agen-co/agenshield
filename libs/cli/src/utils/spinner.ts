/**
 * Spinner utility — wraps ora, respects --json / --quiet / --no-color / non-TTY.
 *
 * Falls back to plain stderr writes when a spinner would not be useful.
 */

import { getOutputOptions } from './output.js';

export interface Spinner {
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
  update(text: string): void;
}

/**
 * Create a spinner instance. When the environment is non-interactive
 * (json, quiet, or not a TTY) this returns a noop stub that silently
 * writes to stderr instead.
 */
export async function createSpinner(text: string): Promise<Spinner> {
  const opts = getOutputOptions();
  const interactive = !opts.json && !opts.quiet && process.stderr.isTTY !== false;

  if (!interactive) {
    // Noop spinner — write plain text to stderr
    return {
      succeed(msg?: string) {
        if (!opts.json && !opts.quiet) {
          process.stderr.write(`\u2713 ${msg ?? text}\n`);
        }
      },
      fail(msg?: string) {
        if (!opts.json) {
          process.stderr.write(`\u2717 ${msg ?? text}\n`);
        }
      },
      stop() { /* noop */ },
      update(newText: string) {
        if (!opts.json && !opts.quiet) {
          process.stderr.write(`  ${newText}\n`);
        }
      },
    };
  }

  // Dynamic import ora (ESM-only)
  const { default: ora } = await import('ora');
  const spinner = ora({
    text,
    stream: process.stderr,
    color: opts.color ? 'cyan' : undefined,
  }).start();

  return {
    succeed(msg?: string) {
      spinner.succeed(msg ?? text);
    },
    fail(msg?: string) {
      spinner.fail(msg ?? text);
    },
    stop() {
      spinner.stop();
    },
    update(newText: string) {
      spinner.text = newText;
    },
  };
}
