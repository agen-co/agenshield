/**
 * Runtime version reader
 *
 * Reads the CLI version from package.json at runtime so that
 * `agenshield --version` always reports the real installed version.
 *
 * In SEA mode, reads from the embedded VERSION asset.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { isSEA, getSEAVersion } from '@agenshield/ipc';

let _cached = '';

/**
 * Return the CLI version from the nearest package.json.
 * In SEA mode, reads from the embedded VERSION asset.
 * Result is cached after the first successful read.
 */
export function getVersion(): string {
  if (_cached) return _cached;

  // SEA mode: version is embedded as an asset
  if (isSEA()) {
    const seaVersion = getSEAVersion();
    if (seaVersion) {
      _cached = seaVersion;
      return _cached;
    }
  }

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
