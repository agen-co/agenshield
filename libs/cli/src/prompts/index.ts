/**
 * Interactive prompt helpers — Ink-based with readline fallbacks.
 *
 * Lazy-loaded: actual ink/react imports are deferred to first call
 * to avoid top-level await issues in CJS SEA bundles.
 *
 * In SEA mode ink is not bundled (external), so the dynamic import
 * will fail and we fall back to readline-based prompts automatically.
 */

export type { SelectOption, SelectConfig } from './ink-select.js';
export type { InputConfig } from './ink-input.js';
export type { BrowserLinkConfig } from './ink-browser-link.js';
export type { MultiSelectOption, MultiSelectConfig } from './ink-multiselect.js';

export async function inkSelect<T extends string = string>(
  ...args: Parameters<typeof import('./ink-select.js').inkSelect<T>>
): ReturnType<typeof import('./ink-select.js').inkSelect<T>> {
  try {
    const { inkSelect: impl } = await import('./ink-select.js');
    return await impl(...args);
  } catch {
    if (process.stderr.isTTY && process.stdin.isTTY) {
      const { ansiSelect } = await import('./ansi-prompts.js');
      return ansiSelect(args[0], args[1]) as Awaited<ReturnType<typeof import('./ink-select.js').inkSelect<T>>>;
    }
    const { readlineSelect } = await import('./readline-fallback.js');
    return readlineSelect(args[0], args[1]) as Awaited<ReturnType<typeof import('./ink-select.js').inkSelect<T>>>;
  }
}

export async function inkInput(
  ...args: Parameters<typeof import('./ink-input.js').inkInput>
): ReturnType<typeof import('./ink-input.js').inkInput> {
  try {
    const { inkInput: impl } = await import('./ink-input.js');
    return await impl(...args);
  } catch {
    if (process.stderr.isTTY && process.stdin.isTTY) {
      const { ansiInput } = await import('./ansi-prompts.js');
      return ansiInput(args[0]);
    }
    const { readlineInput } = await import('./readline-fallback.js');
    return readlineInput(args[0]);
  }
}

export async function inkBrowserLink(
  ...args: Parameters<typeof import('./ink-browser-link.js').inkBrowserLink>
): Promise<'opened' | 'skipped'> {
  try {
    const { inkBrowserLink: impl } = await import('./ink-browser-link.js');
    return await impl(...args);
  } catch {
    if (process.stderr.isTTY && process.stdin.isTTY) {
      const { ansiBrowserLink } = await import('./ansi-prompts.js');
      return ansiBrowserLink(args[0]);
    }
    // No readline equivalent for browser link — just print the URL
    const { output } = await import('../utils/output.js');
    const config = args[0];
    output.info(`Open in browser: ${config.url}`);
    return 'skipped';
  }
}

export async function inkMultiSelect<T extends string = string>(
  ...args: Parameters<typeof import('./ink-multiselect.js').inkMultiSelect<T>>
): Promise<T[]> {
  try {
    const { inkMultiSelect: impl } = await import('./ink-multiselect.js');
    return await impl(...args);
  } catch {
    if (process.stderr.isTTY && process.stdin.isTTY) {
      const { ansiMultiSelect } = await import('./ansi-prompts.js');
      return ansiMultiSelect(args[0], args[1]) as unknown as T[];
    }
    const { readlineMultiSelect } = await import('./readline-fallback.js');
    return readlineMultiSelect(args[0], args[1]) as unknown as T[];
  }
}
