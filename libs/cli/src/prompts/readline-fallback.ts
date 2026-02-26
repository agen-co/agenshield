/**
 * Readline-based prompt fallbacks for non-interactive environments.
 *
 * Used when stderr is not a TTY or when --json / --quiet flags are set.
 */

import * as readline from 'node:readline';
import { output } from '../utils/output.js';

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

/**
 * Present a numbered list and wait for the user to pick one.
 * Returns the selected value, or `null` if stdin closes before selection.
 */
export async function readlineSelect<T extends string>(
  options: { label: string; value: T; description?: string }[],
  config?: { title?: string },
): Promise<T | null> {
  const rl = createRl();
  try {
    if (config?.title) {
      output.info(`  ${config.title}`);
    }
    for (let i = 0; i < options.length; i++) {
      const desc = options[i].description ? ` — ${options[i].description}` : '';
      output.info(`    [${i + 1}] ${options[i].label}${desc}`);
    }
    output.info('');

    return await new Promise<T | null>((resolve) => {
      const ask = () => {
        rl.question('  Enter choice: ', (answer) => {
          const idx = parseInt(answer.trim(), 10) - 1;
          if (idx >= 0 && idx < options.length) {
            resolve(options[idx].value);
          } else {
            output.warn(`  Please enter a number between 1 and ${options.length}`);
            ask();
          }
        });
      };

      rl.on('close', () => resolve(null));
      ask();
    });
  } finally {
    rl.close();
  }
}

/**
 * Parse a multi-select input string into an array of zero-based indices.
 *
 * Accepts comma-separated numbers, ranges (e.g. `1-3`), `all`, and `none`.
 * Returns `null` for `none` or empty input, a Set of indices for valid input,
 * or `undefined` if the input is malformed.
 */
function parseMultiSelectInput(raw: string, max: number): Set<number> | null | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'none') return null;
  if (trimmed === 'all') {
    const set = new Set<number>();
    for (let i = 0; i < max; i++) set.add(i);
    return set;
  }

  const indices = new Set<number>();
  for (const part of trimmed.split(',')) {
    const segment = part.trim();
    if (!segment) continue;

    const rangeMatch = segment.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo < 1 || hi < lo || hi > max) return undefined;
      for (let i = lo; i <= hi; i++) indices.add(i - 1);
    } else {
      const num = parseInt(segment, 10);
      if (isNaN(num) || num < 1 || num > max) return undefined;
      indices.add(num - 1);
    }
  }

  return indices.size > 0 ? indices : null;
}

/**
 * Present a numbered list and let the user pick one or more items.
 *
 * Accepts comma-separated numbers (`1,3,5`), ranges (`1-3`), `all`, or `none`.
 * Returns the selected values array, or an empty array if cancelled / none.
 */
export async function readlineMultiSelect<T extends string>(
  options: { label: string; value: T; description?: string }[],
  config?: { title?: string },
): Promise<T[]> {
  const rl = createRl();
  try {
    if (config?.title) {
      output.info(`  ${config.title}`);
    }
    for (let i = 0; i < options.length; i++) {
      const desc = options[i].description ? ` — ${options[i].description}` : '';
      output.info(`    [${i + 1}] ${options[i].label}${desc}`);
    }
    output.info('');
    output.info('  Enter numbers (e.g. 1,3,5), ranges (1-3), "all", or "none"');

    return await new Promise<T[]>((resolve) => {
      const ask = () => {
        rl.question('  Selection: ', (answer) => {
          const parsed = parseMultiSelectInput(answer, options.length);
          if (parsed === undefined) {
            output.warn(`  Invalid input. Enter numbers 1-${options.length}, ranges, "all", or "none".`);
            ask();
            return;
          }
          if (parsed === null) {
            resolve([]);
            return;
          }
          resolve([...parsed].sort((a, b) => a - b).map((i) => options[i].value));
        });
      };

      rl.on('close', () => resolve([]));
      ask();
    });
  } finally {
    rl.close();
  }
}

/**
 * Ask for text input with an optional default value.
 * Returns the entered string, or `null` if stdin closes.
 */
export async function readlineInput(
  config: { prompt: string; defaultValue?: string },
): Promise<string | null> {
  const rl = createRl();
  try {
    const suffix = config.defaultValue ? ` (${config.defaultValue})` : '';
    return await new Promise<string | null>((resolve) => {
      rl.question(`  ${config.prompt}${suffix}: `, (answer) => {
        const value = answer.trim();
        resolve(value || config.defaultValue || '');
      });

      rl.on('close', () => resolve(null));
    });
  } finally {
    rl.close();
  }
}
