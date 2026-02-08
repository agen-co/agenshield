/**
 * Debug Logger
 *
 * Writes diagnostic logs to /var/log/agenshield/interceptor.log using
 * a captured (pre-patch) appendFileSync. Safe from interception.
 * Falls back to /tmp/agenshield-interceptor.log if primary path is not writable.
 */

import * as fs from 'node:fs';

// Capture BEFORE any interceptor can patch fs
const _appendFileSync = fs.appendFileSync.bind(fs);
const _writeSync = fs.writeSync.bind(fs);

const LOG_PATH = '/var/log/agenshield/interceptor.log';
const FALLBACK_LOG_PATH = '/tmp/agenshield-interceptor.log';

let resolvedLogPath: string | null = null;

function getLogPath(): string {
  if (resolvedLogPath !== null) return resolvedLogPath;
  try {
    _appendFileSync(LOG_PATH, '');
    resolvedLogPath = LOG_PATH;
  } catch {
    resolvedLogPath = FALLBACK_LOG_PATH;
  }
  return resolvedLogPath;
}

export function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] [pid:${process.pid}] ${msg}\n`;
  try { _appendFileSync(getLogPath(), line); } catch {}
  // Mirror to stderr when debug is enabled
  if (process.env['AGENSHIELD_LOG_LEVEL'] === 'debug') {
    try { _writeSync(2, `[AgenShield:debug] ${msg}\n`); } catch {}
  }
}
