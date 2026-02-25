/**
 * Runtime version reader
 *
 * Reads the CLI version from package.json at runtime so that
 * `agenshield --version` always reports the real installed version.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

let _cached = '';

/**
 * Return the CLI version from the nearest package.json.
 * Result is cached after the first successful read.
 */
export function getVersion(): string {
  if (_cached) return _cached;

  try {
    const pkgPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '../../package.json',
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    _cached = (pkg.version as string) ?? 'unknown';
  } catch {
    _cached = 'unknown';
  }

  return _cached;
}
