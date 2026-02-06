/**
 * Debug Logger
 *
 * Writes diagnostic logs to /var/log/agenshield/interceptor.log using
 * a captured (pre-patch) appendFileSync. Safe from interception.
 */

import * as fs from 'node:fs';

// Capture BEFORE any interceptor can patch fs
const _appendFileSync = fs.appendFileSync.bind(fs);

const LOG_PATH = '/var/log/agenshield/interceptor.log';

export function debugLog(msg: string): void {
  try {
    _appendFileSync(LOG_PATH, `[${new Date().toISOString()}] [pid:${process.pid}] ${msg}\n`);
  } catch {
    // Silently ignore — log dir may not exist or not writable
  }
}
