/**
 * SEA (Single Executable Application) Runtime Utilities
 *
 * Provides detection and path resolution for when AgenShield runs
 * as a Node.js Single Executable Application.
 *
 * Import from `@agenshield/ipc` — all libs that need SEA awareness use this.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let _isSea: boolean | undefined;

/**
 * Detect whether the current process is a Node.js Single Executable Application.
 */
export function isSEA(): boolean {
  if (_isSea !== undefined) return _isSea;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = require('node:sea');
    _isSea = typeof sea.isSea === 'function' ? (sea.isSea() as boolean) : false;
  } catch {
    _isSea = false;
  }
  return _isSea;
}

/**
 * Get the SEA-embedded VERSION asset string.
 * Returns null if not running as SEA.
 */
export function getSEAVersion(): string | null {
  if (!isSEA()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = require('node:sea');
    return (sea.getAsset('VERSION', 'utf8') as string).trim();
  } catch {
    return null;
  }
}

/**
 * Get a SEA-embedded asset as a string.
 * Returns null if not running as SEA or asset not found.
 */
export function getSEAAssetString(name: string): string | null {
  if (!isSEA()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = require('node:sea');
    return sea.getAsset(name, 'utf8') as string;
  } catch {
    return null;
  }
}

/**
 * Get the version-stamped runtime lib directory.
 * Assets are extracted here on first run.
 *
 * @returns `~/.agenshield/lib/v{VERSION}/` or null if not SEA
 */
export function getSEALibDir(): string | null {
  const version = getSEAVersion();
  if (!version) return null;
  return path.join(os.homedir(), '.agenshield', 'lib', `v${version}`);
}

/**
 * Check if the SEA lib directory exists and has been extracted.
 */
export function isSEAExtracted(): boolean {
  const libDir = getSEALibDir();
  if (!libDir) return false;
  const stampFile = path.join(libDir, '.extracted');
  try {
    const version = getSEAVersion();
    const stamp = fs.readFileSync(stampFile, 'utf8').trim();
    return stamp === version;
  } catch {
    return false;
  }
}
