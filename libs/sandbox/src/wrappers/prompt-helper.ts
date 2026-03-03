/**
 * Prompt Helper Generator
 *
 * Generates a standalone Node.js script (`agenshield-prompt`) that provides
 * interactive ANSI select menus for the router wrapper. Zero npm dependencies —
 * only Node built-ins. Ported from libs/cli/src/prompts/ansi-prompts.ts.
 *
 * The script accepts:
 *   --title "text" --option "opt1" --option "opt2" [--cancel]
 * Outputs 1-based selection index to stdout (0 if cancelled).
 * All UI rendering goes to stderr.
 */

/**
 * Generate the Node.js prompt helper script content.
 * This is written to `~/.agenshield/bin/agenshield-prompt` and called
 * by the router wrapper's `_agenshield_select` function.
 */
export function generatePromptHelper(): string {
  return `#!/usr/bin/env node
'use strict';

// ── Parse CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
let title = '';
const options = [];
let allowCancel = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--title' && i + 1 < args.length) {
    title = args[++i];
  } else if (args[i] === '--option' && i + 1 < args.length) {
    options.push(args[++i]);
  } else if (args[i] === '--cancel') {
    allowCancel = true;
  }
}

if (options.length === 0) {
  process.stdout.write('0\\n');
  process.exit(0);
}

// ── ANSI constants ────────────────────────────────────────────────────
const ESC = '\\x1b';
const HIDE_CURSOR = ESC + '[?25l';
const SHOW_CURSOR = ESC + '[?25h';
const CLEAR_LINE = ESC + '[2K';
const RESET = ESC + '[0m';

function cursorUp(n) {
  return n > 0 ? ESC + '[' + n + 'A' : '';
}

function c(color, text) {
  const COLORS = {
    green: ESC + '[32m',
    cyan: ESC + '[36m',
    bold: ESC + '[1m',
    dim: ESC + '[2m',
  };
  return (COLORS[color] || '') + text + RESET;
}

// ── Key parsing ───────────────────────────────────────────────────────
function parseKey(data) {
  const s = data.toString('utf8');
  if (s === '\\x03') return { name: 'ctrl-c' };
  if (s === '\\r' || s === '\\n') return { name: 'return' };
  if (s === ESC) return { name: 'escape' };
  if (s === ESC + '[A') return { name: 'up' };
  if (s === ESC + '[B') return { name: 'down' };
  if (s.length === 1 && s.charCodeAt(0) >= 0x31 && s.charCodeAt(0) <= 0x39) {
    return { name: 'num', value: parseInt(s, 10) };
  }
  return { name: 'unknown' };
}

// ── Renderer ──────────────────────────────────────────────────────────
let lineCount = 0;

function render(lines) {
  if (lineCount > 0) {
    process.stderr.write(cursorUp(lineCount));
  }
  const max = Math.max(lineCount, lines.length);
  for (let i = 0; i < max; i++) {
    process.stderr.write(CLEAR_LINE + (lines[i] || '') + '\\n');
  }
  lineCount = lines.length;
}

function clearRender() {
  if (lineCount > 0) {
    process.stderr.write(cursorUp(lineCount));
    for (let i = 0; i < lineCount; i++) {
      process.stderr.write(CLEAR_LINE + '\\n');
    }
    process.stderr.write(cursorUp(lineCount));
  }
  lineCount = 0;
}

// ── Non-TTY fallback ──────────────────────────────────────────────────
if (!process.stdin.isTTY || !process.stderr.isTTY) {
  process.stderr.write('\\n  ' + title + '\\n\\n');
  for (let i = 0; i < options.length; i++) {
    process.stderr.write('  ' + (i + 1) + ') ' + options[i] + '\\n');
  }
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  rl.question('Select [1-' + options.length + ']: ', (answer) => {
    rl.close();
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= options.length) {
      process.stdout.write(num + '\\n');
    } else {
      process.stdout.write('0\\n');
    }
  });
} else {
  // ── Interactive TTY mode ──────────────────────────────────────────
  let index = 0;
  const wasRaw = process.stdin.isRaw;

  function restore() {
    process.stderr.write(SHOW_CURSOR);
    if (typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(wasRaw || false);
    }
    process.stdin.pause();
  }

  function finish(selection) {
    clearRender();
    restore();
    process.stdout.write(selection + '\\n');
    process.exit(0);
  }

  process.on('SIGINT', () => {
    clearRender();
    restore();
    process.stdout.write('0\\n');
    process.exit(130);
  });

  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stderr.write(HIDE_CURSOR);

  function draw() {
    const lines = [];
    lines.push(' ' + c('cyan', c('bold', title)));
    lines.push('');
    for (let i = 0; i < options.length; i++) {
      if (i === index) {
        lines.push(c('green', '  > ') + c('green', c('bold', options[i])));
      } else {
        lines.push('    ' + c('dim', options[i]));
      }
    }
    lines.push('');
    let hint = '  \\u2191/\\u2193 Navigate  Enter Confirm';
    if (allowCancel) hint += '  Esc Cancel';
    lines.push(c('dim', hint));
    render(lines);
  }

  draw();

  process.stdin.on('data', (data) => {
    const key = parseKey(data);
    if (key.name === 'ctrl-c') {
      finish(0);
    } else if (key.name === 'up') {
      if (index > 0) index--;
      draw();
    } else if (key.name === 'down') {
      if (index < options.length - 1) index++;
      draw();
    } else if (key.name === 'return') {
      finish(index + 1);
    } else if (key.name === 'escape' && allowCancel) {
      finish(0);
    } else if (key.name === 'num' && key.value <= options.length) {
      finish(key.value);
    }
  });
}
`;
}
