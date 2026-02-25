/**
 * Logs command — stream daemon logs in real time.
 *
 * Prompts for passcode to authenticate, then connects to the daemon's
 * SSE log stream endpoint.
 *
 * @example
 * ```bash
 * agenshield logs
 * agenshield logs --level warn
 * agenshield logs --json
 * agenshield logs -n 100
 * ```
 */

import { Command } from 'commander';
import * as readline from 'node:readline';
import * as http from 'node:http';
import { DAEMON_CONFIG } from '../utils/daemon.js';
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { AuthError, ConnectionError } from '../errors.js';

/** Pino numeric level -> colored label */
const LEVEL_COLORS: Record<string, string> = {
  trace: '\x1b[90mTRACE\x1b[0m',
  debug: '\x1b[36mDEBUG\x1b[0m',
  info:  '\x1b[32m INFO\x1b[0m',
  warn:  '\x1b[33m WARN\x1b[0m',
  error: '\x1b[31mERROR\x1b[0m',
  fatal: '\x1b[35mFATAL\x1b[0m',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function formatLogLine(entry: Record<string, unknown>): string {
  const time = formatTime(entry['time'] as number);
  const levelName = (entry['levelName'] as string) ?? 'info';
  const level = LEVEL_COLORS[levelName] ?? levelName.toUpperCase();
  const msg = (entry['msg'] as string) ?? '';
  return `${time} ${level} ${msg}`;
}

async function promptPasscode(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    process.stderr.write('Passcode: ');
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);

    let passcode = '';
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        rl.close();
        resolve(passcode);
      } else if (c === '\u007f' || c === '\b') {
        passcode = passcode.slice(0, -1);
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit(0);
      } else {
        passcode += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function authenticate(passcode: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ passcode });
    const req = http.request({
      hostname: DAEMON_CONFIG.HOST,
      port: DAEMON_CONFIG.PORT,
      path: '/api/auth/unlock',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode === 200 && json.token) {
            resolve(json.token as string);
          } else {
            const errMsg = typeof json.error === 'string'
              ? json.error
              : json.error?.message ?? 'Authentication failed';
            reject(new AuthError(errMsg));
          }
        } catch {
          reject(new AuthError(`Invalid response (HTTP ${res.statusCode})`));
        }
      });
    });
    req.on('error', (err) => reject(new ConnectionError(`Cannot connect to daemon: ${err.message}`)));
    req.write(data);
    req.end();
  });
}

function streamLogs(token: string, level: string, recent: number, jsonMode: boolean): void {
  const url = `/api/logs/stream?token=${encodeURIComponent(token)}&level=${level}&recent=${recent}`;

  const req = http.request({
    hostname: DAEMON_CONFIG.HOST,
    port: DAEMON_CONFIG.PORT,
    path: url,
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  }, (res) => {
    if (res.statusCode !== 200) {
      throw new ConnectionError(`Failed to connect to log stream (HTTP ${res.statusCode})`);
    }

    let buffer = '';

    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6);
          try {
            const entry = JSON.parse(raw);
            if (jsonMode) {
              console.log(raw);
            } else {
              console.log(formatLogLine(entry));
            }
          } catch {
            // Skip malformed entries
          }
        }
      }
    });

    res.on('end', () => {
      output.info('Log stream disconnected');
      process.exit(0);
    });
  });

  req.on('error', (err) => {
    throw new ConnectionError(`Connection error: ${err.message}`);
  });

  req.end();

  process.on('SIGINT', () => {
    req.destroy();
    process.exit(0);
  });
}

export function createLogsCommand(): Command {
  const cmd = new Command('logs')
    .description('Stream daemon logs in real time')
    .option('--level <level>', 'Minimum log level (trace, debug, info, warn, error, fatal)', 'info')
    .option('--json', 'Output raw JSON log entries')
    .option('-n <lines>', 'Number of recent log entries to show', '50')
    .action(async (options) => {
      ensureSetupComplete();
      const level = options.level as string;
      const jsonMode = !!options.json;
      const recent = Number(options.n) || 50;

      const passcode = await promptPasscode();

      const token = await authenticate(passcode);

      output.info(`Streaming logs (level: ${level}, recent: ${recent})...`);
      streamLogs(token, level, recent, jsonMode);
    });

  return cmd;
}
