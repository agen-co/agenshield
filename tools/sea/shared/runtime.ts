/**
 * SEA Runtime Helpers (Multi-Binary)
 *
 * Each binary calls setupSEARuntime() with its own options.
 * The VERSION asset and native module setup are always done.
 * Asset extraction is opt-in per binary.
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
 */
export function getSEAVersion(): string {
  if (!isSEA()) throw new Error('Not running as SEA');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sea = require('node:sea');
  return (sea.getAsset('VERSION', 'utf8') as string).trim();
}

/**
 * Get the SEA-embedded asset as a string or ArrayBuffer.
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
 */
export function getLibDir(): string {
  const version = getSEAVersion();
  return path.join(os.homedir(), '.agenshield', 'lib', `v${version}`);
}

export interface SEASetupOptions {
  /** Extract worker scripts (system-command.worker.js) — daemon only */
  extractWorkers?: boolean;
  /** Extract interceptor register scripts — daemon only */
  extractInterceptors?: boolean;
  /** Extract UI assets tarball — daemon only */
  extractUI?: boolean;
}

/**
 * Extract embedded SEA assets to the lib directory if not already done.
 */
export function extractAssetsIfNeeded(opts: SEASetupOptions = {}): void {
  if (!isSEA()) return;

  const libDir = getLibDir();
  const version = getSEAVersion();

  // Build a stamp key from the options so daemon extracts its assets
  // even if CLI already extracted the base stamp
  const optKey = [
    opts.extractWorkers ? 'w' : '',
    opts.extractInterceptors ? 'i' : '',
    opts.extractUI ? 'u' : '',
  ].join('');
  const stampFile = path.join(libDir, '.extracted');
  const expectedStamp = optKey ? `${version}:${optKey}` : version;

  // Check if already extracted for this version + options
  try {
    const stamp = fs.readFileSync(stampFile, 'utf8').trim();
    if (stamp === expectedStamp) return;
  } catch {
    // Stamp doesn't exist — need to extract
  }

  fs.mkdirSync(libDir, { recursive: true });

  // Extract worker script
  if (opts.extractWorkers) {
    try {
      const workersDir = path.join(libDir, 'workers');
      fs.mkdirSync(workersDir, { recursive: true });
      const workerCode = getSEAAsset('system-command-worker.js', 'utf8');
      fs.writeFileSync(path.join(workersDir, 'system-command.worker.js'), workerCode);
    } catch {
      // Worker asset may not be embedded in this binary
    }
  }

  // Extract interceptor scripts
  if (opts.extractInterceptors) {
    try {
      const interceptorDir = path.join(libDir, 'interceptor');
      fs.mkdirSync(interceptorDir, { recursive: true });
      const registerCjs = getSEAAsset('interceptor-register.cjs', 'utf8');
      fs.writeFileSync(path.join(interceptorDir, 'register.cjs'), registerCjs);
      const registerMjs = getSEAAsset('interceptor-register.mjs', 'utf8');
      fs.writeFileSync(path.join(interceptorDir, 'register.mjs'), registerMjs);
    } catch {
      // Interceptor assets may not be embedded in this binary
    }
  }

  // Extract UI assets (compressed tar)
  if (opts.extractUI) {
    try {
      const uiTarBuffer = getSEAAsset('ui-assets.tar.gz');
      const uiTarPath = path.join(libDir, 'ui-assets.tar.gz');
      fs.writeFileSync(uiTarPath, Buffer.from(uiTarBuffer));

      const uiAssetsDir = path.join(libDir, 'ui-assets');
      fs.mkdirSync(uiAssetsDir, { recursive: true });

      const { execSync } = require('node:child_process') as typeof import('node:child_process');
      execSync(`tar -xzf "${uiTarPath}" -C "${uiAssetsDir}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      });

      fs.unlinkSync(uiTarPath);
    } catch {
      // UI assets extraction failed — non-fatal
    }
  }

  // Write version stamp
  fs.writeFileSync(stampFile, expectedStamp);
}

/**
 * Set up the environment for the better-sqlite3 native addon.
 */
export function setupNativeModules(): void {
  if (!isSEA()) return;

  const nativeDir = path.join(getLibDir(), 'native');
  const bindingPath = path.join(nativeDir, 'better_sqlite3.node');

  if (fs.existsSync(bindingPath)) {
    process.env['BETTER_SQLITE3_BINDING'] = bindingPath;
  }
}

/**
 * Full SEA runtime setup — call once at process startup.
 * Each binary passes its own options for which assets to extract.
 */
export function setupSEARuntime(opts?: SEASetupOptions): void {
  if (!isSEA()) return;
  extractAssetsIfNeeded(opts);
  setupNativeModules();
}
