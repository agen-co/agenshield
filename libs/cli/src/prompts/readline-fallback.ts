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
