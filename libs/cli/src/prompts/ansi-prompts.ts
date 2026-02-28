/**
 * Pure ANSI escape-code interactive prompts.
 *
 * Zero external dependencies — only Node built-ins (process, child_process).
 * Designed for SEA binaries where ink/react are not available but the
 * terminal is a TTY. Falls through to readline-fallback when stdin is
 * not a TTY.
 *
 * Rendering goes to stderr (matching ink convention).
 */

import { execSync } from 'node:child_process';
import { getOutputOptions } from '../utils/output.js';

// ── ANSI constants ────────────────────────────────────────────────────

const ESC = '\x1b';
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_LINE = `${ESC}[2K`;
const RESET = `${ESC}[0m`;

function cursorUp(n: number): string {
  return n > 0 ? `${ESC}[${n}A` : '';
}

// ── Color helper ──────────────────────────────────────────────────────

const COLORS: Record<string, string> = {
  green: `${ESC}[32m`,
  cyan: `${ESC}[36m`,
  gray: `${ESC}[90m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  white: `${ESC}[37m`,
};

function c(color: string, text: string): string {
  if (!getOutputOptions().color) return text;
  return `${COLORS[color] ?? ''}${text}${RESET}`;
}

// ── Key parsing ───────────────────────────────────────────────────────

interface KeyEvent {
  name: string;
  char: string;
  ctrl: boolean;
}

function parseKey(data: Buffer): KeyEvent {
  const s = data.toString('utf8');

  // Ctrl+C
  if (s === '\x03') return { name: 'ctrl-c', char: '', ctrl: true };
  // Enter / Return
  if (s === '\r' || s === '\n') return { name: 'return', char: '', ctrl: false };
  // Escape (bare or start of sequence)
  if (s === ESC) return { name: 'escape', char: '', ctrl: false };
  // Backspace
  if (s === '\x7f' || s === '\b') return { name: 'backspace', char: '', ctrl: false };
  // Tab
  if (s === '\t') return { name: 'tab', char: '', ctrl: false };
  // Space
  if (s === ' ') return { name: 'space', char: ' ', ctrl: false };

  // Arrow keys (ESC [ A/B/C/D)
  if (s === `${ESC}[A`) return { name: 'up', char: '', ctrl: false };
  if (s === `${ESC}[B`) return { name: 'down', char: '', ctrl: false };
  if (s === `${ESC}[C`) return { name: 'right', char: '', ctrl: false };
  if (s === `${ESC}[D`) return { name: 'left', char: '', ctrl: false };

  // Printable character
  if (s.length === 1 && s.charCodeAt(0) >= 32) {
    return { name: 'char', char: s, ctrl: false };
  }

  return { name: 'unknown', char: s, ctrl: false };
}

// ── Renderer ──────────────────────────────────────────────────────────

class Renderer {
  private lineCount = 0;

  render(lines: string[]): void {
    // Move up and clear previous render
    if (this.lineCount > 0) {
      process.stderr.write(cursorUp(this.lineCount));
    }
    for (let i = 0; i < Math.max(this.lineCount, lines.length); i++) {
      process.stderr.write(`${CLEAR_LINE}${lines[i] ?? ''}\n`);
    }
    this.lineCount = lines.length;
  }

  clear(): void {
    if (this.lineCount > 0) {
      process.stderr.write(cursorUp(this.lineCount));
      for (let i = 0; i < this.lineCount; i++) {
        process.stderr.write(`${CLEAR_LINE}\n`);
      }
      process.stderr.write(cursorUp(this.lineCount));
    }
    this.lineCount = 0;
  }
}

// ── Terminal lifecycle ────────────────────────────────────────────────

async function withRawTerminal<T>(
  hideCursor: boolean,
  fn: (onKey: () => Promise<KeyEvent>) => Promise<T>,
): Promise<T> {
  const wasRaw = process.stdin.isRaw;

  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  if (hideCursor) {
    process.stderr.write(HIDE_CURSOR);
  }

  // Handle SIGINT gracefully
  const sigintHandler = () => {
    restore();
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);

  function restore() {
    process.removeListener('SIGINT', sigintHandler);
    if (hideCursor) {
      process.stderr.write(SHOW_CURSOR);
    }
    if (typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(wasRaw ?? false);
    }
    process.stdin.pause();
  }

  const onKey = (): Promise<KeyEvent> => {
    return new Promise((resolve) => {
      const handler = (data: Buffer) => {
        process.stdin.removeListener('data', handler);
        const key = parseKey(data);
        if (key.name === 'ctrl-c') {
          restore();
          process.exit(130);
        }
        resolve(key);
      };
      process.stdin.on('data', handler);
    });
  };

  try {
    return await fn(onKey);
  } finally {
    restore();
  }
}

// ── ansiSelect ────────────────────────────────────────────────────────

export interface AnsiSelectOption<T extends string = string> {
  label: string;
  value: T;
  description?: string;
}

export interface AnsiSelectConfig {
  title?: string;
  subtitle?: string;
}

export async function ansiSelect<T extends string = string>(
  options: AnsiSelectOption<T>[],
  config?: AnsiSelectConfig,
): Promise<T | null> {
  const renderer = new Renderer();

  return withRawTerminal(true, async (onKey) => {
    let index = 0;

    function draw() {
      const lines: string[] = [];

      if (config?.title) {
        lines.push(` ${c('cyan', c('bold', config.title))}`);
        lines.push('');
      }
      if (config?.subtitle) {
        lines.push(` ${c('gray', config.subtitle)}`);
        lines.push('');
      }

      for (let i = 0; i < options.length; i++) {
        const active = i === index;
        const prefix = active ? c('green', '> ') : '  ';
        const label = active
          ? c('green', c('bold', options[i].label))
          : ` ${options[i].label}`;
        lines.push(`${prefix}${label}`);
        if (options[i].description) {
          lines.push(`    ${c('gray', options[i].description!)}`);
        }
      }

      lines.push('');
      lines.push(` ${c('dim', 'Arrow keys to select, Enter to confirm, Esc to cancel')}`);
      renderer.render(lines);
    }

    draw();

    for (;;) {
      const key = await onKey();

      if (key.name === 'up') {
        index = (index - 1 + options.length) % options.length;
        draw();
      } else if (key.name === 'down') {
        index = (index + 1) % options.length;
        draw();
      } else if (key.name === 'return') {
        renderer.clear();
        return options[index].value;
      } else if (key.name === 'escape') {
        renderer.clear();
        return null;
      } else if (key.name === 'char') {
        const num = parseInt(key.char, 10);
        if (num >= 1 && num <= options.length) {
          index = num - 1;
          draw();
        }
      }
    }
  });
}

// ── ansiMultiSelect ───────────────────────────────────────────────────

export interface AnsiMultiSelectOption<T extends string = string> {
  label: string;
  value: T;
  description?: string;
}

export interface AnsiMultiSelectConfig {
  title?: string;
  subtitle?: string;
}

export async function ansiMultiSelect<T extends string = string>(
  options: AnsiMultiSelectOption<T>[],
  config?: AnsiMultiSelectConfig,
): Promise<T[]> {
  const renderer = new Renderer();

  return withRawTerminal(true, async (onKey) => {
    let index = 0;
    const checked = new Set<number>();

    function draw() {
      const lines: string[] = [];

      if (config?.title) {
        lines.push(` ${c('cyan', c('bold', config.title))}`);
        lines.push('');
      }
      if (config?.subtitle) {
        lines.push(` ${c('gray', config.subtitle)}`);
        lines.push('');
      }

      for (let i = 0; i < options.length; i++) {
        const active = i === index;
        const isChecked = checked.has(i);
        const prefix = active ? c('green', '> ') : '  ';
        const checkbox = isChecked ? c('green', '[x] ') : c('gray', '[ ] ');
        const label = active
          ? c('bold', options[i].label)
          : options[i].label;
        lines.push(`${prefix}${checkbox}${label}`);
        if (options[i].description) {
          lines.push(`      ${c('gray', options[i].description!)}`);
        }
      }

      lines.push('');
      lines.push(` ${c('dim', "Arrow keys to move, Space to toggle, 'a' to toggle all, Enter to confirm, Esc to cancel")}`);
      renderer.render(lines);
    }

    draw();

    for (;;) {
      const key = await onKey();

      if (key.name === 'up') {
        index = (index - 1 + options.length) % options.length;
        draw();
      } else if (key.name === 'down') {
        index = (index + 1) % options.length;
        draw();
      } else if (key.name === 'space') {
        if (checked.has(index)) {
          checked.delete(index);
        } else {
          checked.add(index);
        }
        draw();
      } else if (key.name === 'char' && key.char === 'a') {
        if (checked.size === options.length) {
          checked.clear();
        } else {
          for (let i = 0; i < options.length; i++) checked.add(i);
        }
        draw();
      } else if (key.name === 'return') {
        renderer.clear();
        return [...checked].sort((a, b) => a - b).map((i) => options[i].value);
      } else if (key.name === 'escape') {
        renderer.clear();
        return [];
      }
    }
  });
}

// ── ansiInput ─────────────────────────────────────────────────────────

export interface AnsiInputConfig {
  prompt: string;
  defaultValue?: string;
  placeholder?: string;
}

export async function ansiInput(config: AnsiInputConfig): Promise<string | null> {
  const renderer = new Renderer();

  return withRawTerminal(false, async (onKey) => {
    let value = config.defaultValue ?? '';
    let cursor = value.length;

    function draw() {
      const lines: string[] = [];
      const promptText = config.defaultValue
        ? `${c('cyan', c('bold', config.prompt))} ${c('gray', `(${config.defaultValue})`)}`
        : c('cyan', c('bold', config.prompt));
      lines.push(` ${promptText}`);

      const display = value || (config.placeholder ? c('gray', config.placeholder) : '');
      lines.push(` ${c('green', '>')} ${display}`);

      lines.push('');
      lines.push(` ${c('dim', 'Enter to confirm, Esc to cancel')}`);
      renderer.render(lines);
    }

    draw();

    for (;;) {
      const key = await onKey();

      if (key.name === 'return') {
        renderer.clear();
        return value.trim() || config.defaultValue || '';
      } else if (key.name === 'escape') {
        renderer.clear();
        return null;
      } else if (key.name === 'backspace') {
        if (cursor > 0) {
          value = value.slice(0, cursor - 1) + value.slice(cursor);
          cursor--;
          draw();
        }
      } else if (key.name === 'left') {
        if (cursor > 0) {
          cursor--;
          draw();
        }
      } else if (key.name === 'right') {
        if (cursor < value.length) {
          cursor++;
          draw();
        }
      } else if (key.name === 'char' || key.name === 'space') {
        value = value.slice(0, cursor) + key.char + value.slice(cursor);
        cursor++;
        draw();
      }
    }
  });
}

// ── ansiBrowserLink ───────────────────────────────────────────────────

export interface AnsiBrowserLinkConfig {
  url: string;
  label?: string;
  token?: string;
}

export async function ansiBrowserLink(
  config: AnsiBrowserLinkConfig,
): Promise<'opened' | 'skipped'> {
  const renderer = new Renderer();

  return withRawTerminal(true, async (onKey) => {
    const lines: string[] = [];
    lines.push(` ${c('bold', config.label ?? 'URL')}:`);
    lines.push(`   ${c('cyan', config.url)}`);
    if (config.token) {
      lines.push(`   ${c('dim', `Token: ${config.token}`)}`);
    }
    lines.push('');
    lines.push(` ${c('dim', 'Press Enter to open in browser, Esc to skip')}`);
    renderer.render(lines);

    for (;;) {
      const key = await onKey();

      if (key.name === 'return') {
        try {
          const cmd =
            process.platform === 'darwin'
              ? `open "${config.url}"`
              : `xdg-open "${config.url}"`;
          execSync(cmd, { stdio: 'pipe' });
        } catch {
          // Silently ignore — URL is displayed for manual copy
        }
        renderer.clear();
        return 'opened';
      } else if (key.name === 'escape') {
        renderer.clear();
        return 'skipped';
      }
    }
  });
}
