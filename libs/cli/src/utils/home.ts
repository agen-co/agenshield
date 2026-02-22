/**
 * Home directory utilities for self-managed CLI installation.
 *
 * All local installation state lives under ~/.agenshield/:
 *   bin/agenshield   - Shell shim (user adds to PATH)
 *   dist/            - Extracted npm package with production deps
 *   version.json     - Tracks installed version metadata
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

/** Root of the local installation: ~/.agenshield */
export const AGENSHIELD_HOME = path.join(os.homedir(), '.agenshield');

/** Directory containing the shell shim */
export function getBinDir(): string {
  return path.join(AGENSHIELD_HOME, 'bin');
}

/** Directory containing the extracted npm package */
export function getDistDir(): string {
  return path.join(AGENSHIELD_HOME, 'dist');
}

/** Path to version.json metadata file */
export function getVersionFilePath(): string {
  return path.join(AGENSHIELD_HOME, 'version.json');
}

/** Path to the shell shim executable */
export function getShimPath(): string {
  return path.join(getBinDir(), 'agenshield');
}

/** Expected CLI entry point inside the extracted dist */
export function getLocalCliEntry(): string {
  return path.join(getDistDir(), 'dist', 'src', 'cli.js');
}

// ---------------------------------------------------------------------------
// Version tracking
// ---------------------------------------------------------------------------

export interface VersionInfo {
  version: string;
  channel: string;
  installedAt: string;
  updatedAt: string;
}

/** Read version.json, returns null when missing or malformed. */
export function readVersionInfo(): VersionInfo | null {
  try {
    const raw = fs.readFileSync(getVersionFilePath(), 'utf-8');
    const data = JSON.parse(raw) as VersionInfo;
    if (typeof data.version !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

/** Write version.json atomically (write-to-tmp then rename). */
export function writeVersionInfo(info: VersionInfo): void {
  const filePath = getVersionFilePath();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(info, null, 2) + '\n');
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Installation detection
// ---------------------------------------------------------------------------

/**
 * Returns true when a valid local installation exists
 * (both dist entry point and version.json are present).
 */
export function isLocalInstall(): boolean {
  return fs.existsSync(getLocalCliEntry()) && fs.existsSync(getVersionFilePath());
}

// ---------------------------------------------------------------------------
// Shell shim
// ---------------------------------------------------------------------------

/**
 * Generate the content of the shell shim script.
 * Uses $HOME so it works correctly under sudo.
 */
export function generateShimContent(): string {
  return [
    '#!/bin/sh',
    '# AgenShield CLI shim — managed by `agenshield install`',
    'exec node "$HOME/.agenshield/dist/dist/src/cli.js" "$@"',
    '',
  ].join('\n');
}

/** Write the shim to ~/.agenshield/bin/agenshield and make it executable. */
export function writeShim(): void {
  const shimPath = getShimPath();
  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  fs.writeFileSync(shimPath, generateShimContent(), { mode: 0o755 });
}

// ---------------------------------------------------------------------------
// Node version check
// ---------------------------------------------------------------------------

/**
 * Validate the running Node.js version meets the minimum major requirement.
 * Returns an error message string on failure, or null on success.
 */
export function checkNodeVersion(minMajor = 22): string | null {
  const major = parseInt(process.versions['node'].split('.')[0], 10);
  if (major < minMajor) {
    return `Node.js >= ${minMajor} is required (current: ${process.versions['node']})`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// npm registry helpers
// ---------------------------------------------------------------------------

/** Query the npm registry for the latest published version of agenshield. */
export function queryLatestVersion(): string {
  const output = execSync('npm view agenshield version', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  return output.trim();
}

// ---------------------------------------------------------------------------
// Download & extract
// ---------------------------------------------------------------------------

export interface DownloadResult {
  success: boolean;
  version: string;
  error?: string;
}

/**
 * Download a specific version of the agenshield package from npm,
 * extract it, and install production dependencies.
 *
 * 1. `npm pack agenshield@<version>` into a tmp directory
 * 2. `tar xzf <tarball>` into destDir with --strip-components=1
 * 3. `npm install --production --no-optional` inside destDir
 */
export function downloadAndExtract(
  version: string,
  destDir?: string,
): DownloadResult {
  const dest = destDir ?? getDistDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenshield-'));

  try {
    // 1. npm pack
    const packOutput = execSync(
      `npm pack "agenshield@${version}" --pack-destination "${tmpDir}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000 },
    ).trim();

    // packOutput is the filename of the tarball (e.g. agenshield-0.7.3.tgz)
    const tarball = path.join(tmpDir, packOutput.split('\n').pop()!.trim());

    if (!fs.existsSync(tarball)) {
      return { success: false, version, error: `Tarball not found: ${tarball}` };
    }

    // 2. Extract
    fs.mkdirSync(dest, { recursive: true });
    execSync(
      `tar xzf "${tarball}" -C "${dest}" --strip-components=1`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 },
    );

    // 3. Install production deps
    execSync('npm install --production --no-optional', {
      cwd: dest,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000,
      env: { ...process.env, NODE_ENV: 'production' },
    });

    return { success: true, version };
  } catch (err) {
    return {
      success: false,
      version,
      error: (err as Error).message,
    };
  } finally {
    // Clean up tmp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}
