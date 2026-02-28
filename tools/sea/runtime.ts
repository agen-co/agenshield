/**
 * SEA Runtime Helpers
 *
 * Centralized SEA detection and path resolution for all libs.
 * Import from `tools/sea/runtime` or use the re-export in `libs/shield-ipc`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let _isSea: boolean | null = null;

/**
 * Detect whether the current process is a Node.js Single Executable Application.
 */
export function isSEA(): boolean {
  if (_isSea !== null) return _isSea;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = require('node:sea');
    _isSea = typeof sea.isSea === 'function' ? sea.isSea() : false;
  } catch {
    _isSea = false;
  }
  return _isSea;
}

/**
 * Get the SEA-embedded VERSION asset string.
 * Throws if not running as SEA.
 */
export function getSEAVersion(): string {
  if (!isSEA()) throw new Error('Not running as SEA');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sea = require('node:sea');
  return (sea.getAsset('VERSION', 'utf8') as string).trim();
}

/**
 * Get the SEA-embedded asset as a string.
 * Throws if not running as SEA.
 */
export function getSEAAsset(name: string, encoding: 'utf8'): string;
export function getSEAAsset(name: string): ArrayBuffer;
export function getSEAAsset(name: string, encoding?: 'utf8'): string | ArrayBuffer {
  if (!isSEA()) throw new Error('Not running as SEA');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sea = require('node:sea');
  if (encoding) {
    return sea.getAsset(name, encoding) as string;
  }
  return sea.getAsset(name) as ArrayBuffer;
}

/**
 * Get the version-stamped runtime lib directory.
 * Assets are extracted here on first run.
 *
 * @returns `~/.agenshield/lib/v{VERSION}/`
 */
export function getLibDir(): string {
  const version = getSEAVersion();
  return path.join(os.homedir(), '.agenshield', 'lib', `v${version}`);
}

/**
 * Extract embedded SEA assets to the lib directory if not already done.
 *
 * Uses a `.extracted` stamp file with version hash to detect when
 * re-extraction is needed (e.g. after upgrade).
 */
export function extractAssetsIfNeeded(): void {
  if (!isSEA()) return;

  const libDir = getLibDir();
  const version = getSEAVersion();
  const stampFile = path.join(libDir, '.extracted');

  // Check if already extracted for this version
  try {
    const stamp = fs.readFileSync(stampFile, 'utf8').trim();
    if (stamp === version) return;
  } catch {
    // Stamp doesn't exist — need to extract
  }

  fs.mkdirSync(libDir, { recursive: true });

  // Extract worker script
  const workersDir = path.join(libDir, 'workers');
  fs.mkdirSync(workersDir, { recursive: true });
  const workerCode = getSEAAsset('system-command-worker.js', 'utf8');
  fs.writeFileSync(path.join(workersDir, 'system-command.worker.js'), workerCode);

  // Extract interceptor scripts
  const interceptorDir = path.join(libDir, 'interceptor');
  fs.mkdirSync(interceptorDir, { recursive: true });
  const registerCjs = getSEAAsset('interceptor-register.cjs', 'utf8');
  fs.writeFileSync(path.join(interceptorDir, 'register.cjs'), registerCjs);
  const registerMjs = getSEAAsset('interceptor-register.mjs', 'utf8');
  fs.writeFileSync(path.join(interceptorDir, 'register.mjs'), registerMjs);

  // Extract UI assets (compressed tar)
  try {
    const uiTarBuffer = getSEAAsset('ui-assets.tar.gz');
    const uiTarPath = path.join(libDir, 'ui-assets.tar.gz');
    fs.writeFileSync(uiTarPath, Buffer.from(uiTarBuffer));

    const uiAssetsDir = path.join(libDir, 'ui-assets');
    fs.mkdirSync(uiAssetsDir, { recursive: true });

    // Extract using tar (available on macOS and Linux)
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    execSync(`tar -xzf "${uiTarPath}" -C "${uiAssetsDir}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });

    // Clean up tar file
    fs.unlinkSync(uiTarPath);
  } catch {
    // UI assets extraction failed — non-fatal, dashboard just won't be available
  }

  // Write version stamp
  fs.writeFileSync(stampFile, version);
}

/**
 * In SEA mode, set up the environment for the better-sqlite3 native addon.
 *
 * The native `.node` file is shipped alongside the binary in the archive
 * and copied to `~/.agenshield/lib/v{VERSION}/native/` during extraction
 * or by the installer.
 */
export function setupNativeModules(): void {
  if (!isSEA()) return;

  const nativeDir = path.join(getLibDir(), 'native');
  const bindingPath = path.join(nativeDir, 'better_sqlite3.node');

  if (fs.existsSync(bindingPath)) {
    // better-sqlite3 respects this env var for locating the native addon
    process.env['BETTER_SQLITE3_BINDING'] = bindingPath;
  }
}

/**
 * Full SEA runtime setup — call once at process startup.
 */
export function setupSEARuntime(): void {
  if (!isSEA()) return;
  extractAssetsIfNeeded();
  setupNativeModules();
}
