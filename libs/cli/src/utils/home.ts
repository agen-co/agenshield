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
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { isSEA, resolveCodesignIdentifier } from '@agenshield/ipc';
import { resolveHostHome } from './host-user.js';

// ---------------------------------------------------------------------------
// Async spawn helpers
// ---------------------------------------------------------------------------

interface SpawnResult { stdout: string; stderr: string }

function spawnAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number },
  onStderr?: (line: string) => void,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d; });
    child.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      if (onStderr) {
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) onStderr(trimmed);
        }
      }
    });
    const timer = opts.timeout
      ? setTimeout(() => { child.kill(); reject(new Error('Timed out')); }, opts.timeout)
      : undefined;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `Exit code ${code}`));
    });
    child.on('error', reject);
  });
}

function shellAsync(
  cmd: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number },
  onStderr?: (line: string) => void,
): Promise<SpawnResult> {
  return spawnAsync('sh', ['-c', cmd], opts, onStderr);
}

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

/** Root of the local installation: ~/.agenshield */
export const AGENSHIELD_HOME = path.join(resolveHostHome(), '.agenshield');

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
  return path.join(getDistDir(), 'src', 'cli.js');
}

// ---------------------------------------------------------------------------
// Version tracking
// ---------------------------------------------------------------------------

/** Installation format */
export type InstallFormat = 'npm' | 'sea' | 'monorepo';

export interface VersionInfo {
  version: string;
  channel: string;
  installedAt: string;
  updatedAt: string;
  /** Installation format — 'sea' for binary, 'npm' for npm-pack */
  format?: InstallFormat;
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
  const nodePath = process.execPath;
  return [
    '#!/bin/sh',
    '# AgenShield CLI shim — managed by `agenshield install`',
    `exec "${nodePath}" "$HOME/.agenshield/dist/src/cli.js" "$@"`,
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
export async function downloadAndExtract(
  version: string,
  destDir?: string,
  onProgress?: (step: string) => void,
): Promise<DownloadResult> {
  const dest = destDir ?? getDistDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenshield-'));

  try {
    // 1. npm pack
    onProgress?.(`Downloading agenshield@${version}...`);
    const packResult = await shellAsync(
      `npm pack "agenshield@${version}" --pack-destination "${tmpDir}"`,
      { timeout: 120_000 },
    );

    // packOutput is the filename of the tarball (e.g. agenshield-0.7.3.tgz)
    const packOutput = packResult.stdout.trim();
    const tarball = path.join(tmpDir, packOutput.split('\n').pop()!.trim());

    if (!fs.existsSync(tarball)) {
      return { success: false, version, error: `Tarball not found: ${tarball}` };
    }

    // 2. Extract
    onProgress?.('Extracting...');
    fs.mkdirSync(dest, { recursive: true });
    await shellAsync(
      `tar xzf "${tarball}" -C "${dest}" --strip-components=1`,
      { timeout: 60_000 },
    );

    // 3. Install production deps
    onProgress?.('Installing production dependencies...');
    await spawnAsync(
      'npm', ['install', '--production', '--no-optional'],
      { cwd: dest, timeout: 300_000, env: { ...process.env, NODE_ENV: 'production' } },
      (line) => onProgress?.(`npm: ${line}`),
    );

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

// ---------------------------------------------------------------------------
// Local (monorepo) install helpers
// ---------------------------------------------------------------------------

/**
 * Map of all workspace @agenshield/* packages to their monorepo lib directory.
 * Used to rewrite deps to `file:` references for self-contained local installs.
 */
const WORKSPACE_PKG_MAP: Record<string, string> = {
  '@agenshield/broker': 'libs/shield-broker',
  '@agenshield/daemon': 'libs/shield-daemon',
  '@agenshield/interceptor': 'libs/interceptor',
  '@agenshield/ipc': 'libs/shield-ipc',
  '@agenshield/patcher': 'libs/interceptor',
  '@agenshield/sandbox': 'libs/sandbox',
  '@agenshield/storage': 'libs/storage',
  '@agenshield/auth': 'libs/auth',
  '@agenshield/policies': 'libs/policies',
  '@agenshield/seatbelt': 'libs/seatbelt',
  '@agentshield/skills': 'libs/skills',
};

/**
 * Walk up from the current script location looking for a package.json
 * with a `workspaces` field — i.e. the monorepo root.
 */
export function findMonorepoRoot(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.workspaces) return dir;
      } catch { /* ignore */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Install AgenShield from local monorepo build output instead of npm.
 *
 * Copies `libs/cli/dist/` to `~/.agenshield/dist/`, then copies each
 * workspace package's dist directly into `node_modules/` (no npm pack).
 * Collects third-party deps from all workspace packages and runs a single
 * `npm install --production` to resolve only non-workspace dependencies.
 */
export async function installFromLocal(
  repoRoot: string,
  destDir?: string,
  onProgress?: (step: string) => void,
): Promise<DownloadResult> {
  const dest = destDir ?? getDistDir();
  const srcDir = path.join(repoRoot, 'libs', 'cli', 'dist');

  if (!fs.existsSync(srcDir)) {
    return {
      success: false,
      version: 'unknown',
      error: `CLI build output not found at ${srcDir}. Run: npx nx build cli`,
    };
  }

  try {
    // Remove existing dest (file, dir, or symlink)
    try {
      const stat = fs.lstatSync(dest);
      if (stat.isSymbolicLink() || stat.isFile()) {
        fs.unlinkSync(dest);
      } else if (stat.isDirectory()) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
    } catch { /* doesn't exist yet */ }

    // Copy CLI dist contents to dest (rsync preferred, cp -r fallback)
    fs.mkdirSync(dest, { recursive: true });
    onProgress?.('Copying CLI build output...');
    try {
      await shellAsync(`rsync -a "${srcDir}/" "${dest}/"`, { timeout: 60_000 });
    } catch {
      // rsync unavailable — fall back to cp
      await shellAsync(`cp -R "${srcDir}/." "${dest}/"`, { timeout: 60_000 });
    }

    // Read version from copied package.json
    const pkgPath = path.join(dest, 'package.json');
    let version = 'unknown';
    let pkg: Record<string, unknown> = {};
    if (fs.existsSync(pkgPath)) {
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (typeof pkg['version'] === 'string') version = pkg['version'] as string;
      } catch { /* ignore */ }
    }

    // Step A: Validate workspace packages and collect third-party deps
    const entries = Object.entries(WORKSPACE_PKG_MAP);
    const total = entries.length;
    const mergedDeps: Record<string, string> = {};

    for (let i = 0; i < entries.length; i++) {
      const [pkgName, libDir] = entries[i];
      const distPath = path.join(repoRoot, libDir, 'dist');
      const distPkg = path.join(distPath, 'package.json');

      if (!fs.existsSync(distPkg)) {
        return {
          success: false,
          version,
          error: `Build output missing for ${pkgName}: ${distPkg}\nRun: npx nx build ${libDir.split('/').pop()}`,
        };
      }

      // Collect non-workspace third-party deps
      try {
        const wsPkg = JSON.parse(fs.readFileSync(distPkg, 'utf-8'));
        const wsDeps = (wsPkg.dependencies ?? {}) as Record<string, string>;
        for (const [dep, ver] of Object.entries(wsDeps)) {
          if (!dep.startsWith('@agenshield/') && !dep.startsWith('@agentshield/')) {
            // Keep the highest version if there's a conflict
            if (!mergedDeps[dep]) {
              mergedDeps[dep] = ver;
            }
          }
        }
      } catch { /* ignore — deps will be resolved by npm */ }
    }

    // Step B: Rewrite CLI's package.json — remove workspace deps, merge third-party
    const deps = (pkg['dependencies'] ?? {}) as Record<string, string>;
    for (const key of Object.keys(deps)) {
      if (key.startsWith('@agenshield/') || key.startsWith('@agentshield/')) {
        delete deps[key];
      }
    }
    // Merge collected third-party deps (CLI's own deps take priority)
    for (const [dep, ver] of Object.entries(mergedDeps)) {
      if (!deps[dep]) {
        deps[dep] = ver;
      }
    }
    pkg['dependencies'] = deps;
    delete pkg['overrides'];
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

    // Step C: Install only third-party production deps (before copying workspace
    // packages so npm prune doesn't delete them)
    onProgress?.('Installing production dependencies...');
    await spawnAsync(
      'npm', ['install', '--production', '--no-optional'],
      { cwd: dest, timeout: 300_000, env: { ...process.env, NODE_ENV: 'production' } },
      (line) => onProgress?.(`npm: ${line}`),
    );

    // Step D: Copy workspace packages into node_modules (after npm install
    // so they aren't pruned as extraneous)
    for (let i = 0; i < entries.length; i++) {
      const [pkgName, libDir] = entries[i];
      const distPath = path.join(repoRoot, libDir, 'dist');

      onProgress?.(`Installing ${pkgName} (${i + 1}/${total})`);

      // Copy dist into node_modules/<scope>/<name>
      const targetDir = path.join(dest, 'node_modules', ...pkgName.split('/'));
      fs.mkdirSync(targetDir, { recursive: true });

      try {
        await shellAsync(`rsync -a "${distPath}/" "${targetDir}/"`, { timeout: 60_000 });
      } catch {
        await shellAsync(`cp -R "${distPath}/." "${targetDir}/"`, { timeout: 60_000 });
      }
    }

    return { success: true, version };
  } catch (err) {
    return {
      success: false,
      version: 'unknown',
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Shell rc PATH management
// ---------------------------------------------------------------------------

const CLI_PATH_COMMENT = '# AgenShield CLI';

/**
 * Ensure the AgenShield bin directory is on PATH by appending an export line
 * to the user's shell rc file (if not already present).
 *
 * Returns which file was modified (or would be modified) and whether
 * the line was actually appended.
 */
export function ensurePathInShellRc(): { added: boolean; rcFile: string } {
  const shell = process.env['SHELL'] || '';
  let rcFile: string;
  const exportLine = 'export PATH="$HOME/.agenshield/bin:$PATH"';

  const hostHome = resolveHostHome();

  if (shell.endsWith('/zsh')) {
    rcFile = path.join(hostHome, '.zshrc');
  } else if (shell.endsWith('/bash')) {
    const bashProfile = path.join(hostHome, '.bash_profile');
    rcFile = fs.existsSync(bashProfile)
      ? bashProfile
      : path.join(hostHome, '.bashrc');
  } else if (shell.endsWith('/fish')) {
    // fish uses different syntax — skip auto-add, just return
    return { added: false, rcFile: '~/.config/fish/config.fish' };
  } else {
    rcFile = path.join(hostHome, '.profile');
  }

  // Check if already present
  try {
    const content = fs.readFileSync(rcFile, 'utf-8');
    if (content.includes('.agenshield/bin')) {
      return { added: false, rcFile };
    }
  } catch { /* file doesn't exist yet, will create */ }

  // Append
  fs.appendFileSync(rcFile, `\n# AgenShield CLI\n${exportLine}\n`);
  return { added: true, rcFile };
}

/**
 * Remove the `# AgenShield CLI` PATH block injected by `ensurePathInShellRc()`.
 * The block consists of a comment line followed by an export line containing
 * `.agenshield/bin`. Both lines are removed together.
 */
export function removeCliPathFromShellRc(
  hostHome?: string,
  hostShell?: string,
): { removed: boolean; rcFile: string } {
  const rcFile = resolveShellRcPath(hostHome, hostShell);

  try {
    const content = fs.readFileSync(rcFile, 'utf-8');
    if (!content.includes(CLI_PATH_COMMENT)) {
      return { removed: false, rcFile };
    }

    const lines = content.split('\n');
    const filtered: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (
        lines[i].trim() === CLI_PATH_COMMENT &&
        i + 1 < lines.length &&
        lines[i + 1].includes('.agenshield/bin')
      ) {
        i++; // skip the export line too
        continue;
      }
      filtered.push(lines[i]);
    }

    if (filtered.length === lines.length) {
      return { removed: false, rcFile };
    }

    // Remove trailing empty lines left by the block removal
    while (filtered.length > 0 && filtered[filtered.length - 1] === '') {
      filtered.pop();
    }
    fs.writeFileSync(rcFile, filtered.join('\n') + '\n');
    return { removed: true, rcFile };
  } catch {
    return { removed: false, rcFile };
  }
}

// ---------------------------------------------------------------------------
// Shell rc PATH override (post-NVM)
// ---------------------------------------------------------------------------

export const PATH_OVERRIDE_START_MARKER = '# >>> AgenShield PATH override >>>';
export const PATH_OVERRIDE_END_MARKER = '# <<< AgenShield PATH override <<<';

/**
 * Resolve the shell rc file path for a given home/shell combination.
 */
function resolveShellRcPath(hostHome?: string, hostShell?: string): string {
  const home = hostHome || resolveHostHome();
  const shell = hostShell || process.env['SHELL'] || '';

  if (shell.endsWith('/zsh')) {
    return path.join(home, '.zshrc');
  } else if (shell.endsWith('/bash')) {
    const bashProfile = path.join(home, '.bash_profile');
    return fs.existsSync(bashProfile) ? bashProfile : path.join(home, '.bashrc');
  }
  return path.join(home, '.profile');
}

/**
 * Append a marked PATH override block at the END of the shell rc file.
 * This ensures `~/.agenshield/bin` is prepended to PATH **after** NVM
 * and Homebrew sourcing, so the AgenShield router takes priority.
 *
 * No-ops if the block is already present. Returns `{ added, rcFile }`.
 */
export function ensurePathOverrideInShellRc(
  hostHome?: string,
  hostShell?: string,
): { added: boolean; rcFile: string } {
  const rcFile = resolveShellRcPath(hostHome, hostShell);

  // Check if already present
  try {
    const content = fs.readFileSync(rcFile, 'utf-8');
    if (content.includes(PATH_OVERRIDE_START_MARKER)) {
      return { added: false, rcFile };
    }
  } catch { /* file doesn't exist yet, will create */ }

  const block = [
    '',
    PATH_OVERRIDE_START_MARKER,
    '# DO NOT EDIT — managed by AgenShield. Remove with `agenshield uninstall`.',
    'export PATH="$HOME/.agenshield/bin:$PATH"',
    PATH_OVERRIDE_END_MARKER,
    '',
  ].join('\n');

  fs.appendFileSync(rcFile, block);
  return { added: true, rcFile };
}

/**
 * Remove the marked PATH override block from the shell rc file.
 * Uses line-by-line filtering to remove everything between (and including) the markers.
 *
 * Returns `{ removed, rcFile }`.
 */
export function removePathOverrideFromShellRc(
  hostHome?: string,
  hostShell?: string,
): { removed: boolean; rcFile: string } {
  const rcFile = resolveShellRcPath(hostHome, hostShell);

  try {
    const content = fs.readFileSync(rcFile, 'utf-8');
    if (!content.includes(PATH_OVERRIDE_START_MARKER)) {
      return { removed: false, rcFile };
    }

    const lines = content.split('\n');
    const filtered: string[] = [];
    let inBlock = false;

    for (const line of lines) {
      if (line.includes(PATH_OVERRIDE_START_MARKER)) {
        inBlock = true;
        continue;
      }
      if (line.includes(PATH_OVERRIDE_END_MARKER)) {
        inBlock = false;
        continue;
      }
      if (!inBlock) {
        filtered.push(line);
      }
    }

    // Remove trailing empty lines left by the block removal
    while (filtered.length > 0 && filtered[filtered.length - 1] === '') {
      filtered.pop();
    }
    // Ensure file ends with a newline
    fs.writeFileSync(rcFile, filtered.join('\n') + '\n');
    return { removed: true, rcFile };
  } catch {
    return { removed: false, rcFile };
  }
}

// ---------------------------------------------------------------------------
// Install format detection
// ---------------------------------------------------------------------------

/**
 * Detect the current installation format.
 *
 * - `sea`: Running as a Single Executable Application binary
 * - `npm`: Local install via `~/.agenshield/dist/` with npm-pack
 * - `monorepo`: Running from the development monorepo
 */
export function detectInstallFormat(): InstallFormat {
  if (isSEA()) return 'sea';
  const info = readVersionInfo();
  if (info?.format === 'sea') return 'sea';
  if (isLocalInstall()) return 'npm';
  return 'monorepo';
}

// ---------------------------------------------------------------------------
// SEA binary helpers
// ---------------------------------------------------------------------------

/** Default GitHub repository for SEA releases */
const DEFAULT_GITHUB_REPO = 'agen-co/agenshield';

/**
 * Query the latest SEA release version from GitHub Releases API.
 * Uses the public API endpoint (no authentication required).
 */
export async function queryLatestSEAVersion(repo = DEFAULT_GITHUB_REPO): Promise<string> {
  const https = await import('node:https');

  return new Promise<string>((resolve, reject) => {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'agenshield-cli',
        'Accept': 'application/vnd.github+json',
      },
      timeout: 15_000,
    }, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers['location'];
        if (location) {
          https.get(location, {
            headers: { 'User-Agent': 'agenshield-cli', 'Accept': 'application/vnd.github+json' },
            timeout: 15_000,
          }, (r2) => {
            let body = '';
            r2.on('data', (chunk: Buffer) => { body += chunk; });
            r2.on('end', () => {
              try {
                const data = JSON.parse(body);
                const tag = (data.tag_name as string) ?? '';
                resolve(tag.replace(/^v/, ''));
              } catch (err) {
                reject(new Error(`Failed to parse GitHub release response: ${(err as Error).message}`));
              }
            });
          }).on('error', reject);
          return;
        }
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GitHub API returned ${res.statusCode}`));
        return;
      }

      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const tag = (data.tag_name as string) ?? '';
          resolve(tag.replace(/^v/, ''));
        } catch (err) {
          reject(new Error(`Failed to parse GitHub release response: ${(err as Error).message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GitHub API request timed out'));
    });
  });
}

/**
 * Detect the current platform string for SEA archive naming.
 */
function detectSEAPlatform(): string {
  return process.platform === 'darwin' ? 'darwin' : 'linux';
}

/**
 * Detect the current architecture string for SEA archive naming.
 */
function detectSEAArch(): string {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * Check whether a path is owned by root (uid 0).
 * Returns true only if the path exists AND is root-owned.
 */
export function isRootOwned(p: string): boolean {
  try {
    return fs.statSync(p).uid === 0;
  } catch {
    return false;
  }
}

/** Try to find our Developer ID in the keychain. Returns the full identity string or null. */
function resolveKeychainIdentity(): string | null {
  if (process.platform !== 'darwin') return null;
  const teamId = process.env['APPLE_TEAM_ID'];
  const orgName = process.env['APPLE_CODESIGN_ORG'];
  if (!teamId || !orgName) return null;
  const identity = `Developer ID Application: ${orgName} (${teamId})`;
  try {
    const result = execSync('security find-identity -v -p codesigning', {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return result.includes(identity) ? identity : null;
  } catch {
    return null;
  }
}

/**
 * Sign a binary with hardened runtime on macOS.
 *
 * Signing modes:
 * - identity provided → `codesign --sign "$identity" --timestamp --options runtime --entitlements`
 * - no identity (ad-hoc) → `codesign --sign - --options runtime --entitlements`
 *
 * Identity resolution: explicit parameter → AGENSHIELD_CODESIGN_IDENTITY env → keychain → ad-hoc.
 */
async function signBinaryHardened(
  binaryPath: string,
  options?: { sudo?: boolean; identity?: string; identifier?: string },
): Promise<void> {
  if (process.platform !== 'darwin') return;

  const prefix = options?.sudo ? 'sudo ' : '';

  // Resolve signing identity: explicit param → env var → ad-hoc (null)
  const identity = options?.identity
    ?? process.env['AGENSHIELD_CODESIGN_IDENTITY']
    ?? resolveKeychainIdentity();

  // Resolve bundle identifier: explicit param → auto-resolve from binary name
  const resolvedId = options?.identifier ?? resolveCodesignIdentifier(binaryPath);
  const idFlag = resolvedId ? ` --identifier "${resolvedId}"` : '';

  // Remove quarantine attribute
  try {
    execSync(`${prefix}xattr -d com.apple.quarantine "${binaryPath}" 2>/dev/null`, { stdio: 'pipe' });
  } catch { /* may not have the attribute */ }

  // Write entitlements plist (includes network entitlements for daemon)
  const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.network.server</key><true/>
</dict>
</plist>`;

  const tmpPlist = path.join(os.tmpdir(), `agenshield-entitlements-${Date.now()}.plist`);
  fs.writeFileSync(tmpPlist, entitlements);
  try {
    if (identity) {
      // Developer ID signing with timestamp + hardened runtime
      execSync(
        `${prefix}codesign --force --sign "${identity}"${idFlag} --timestamp --options runtime --entitlements "${tmpPlist}" "${binaryPath}"`,
        { stdio: 'pipe' },
      );
    } else {
      // Try 1: ad-hoc codesign with entitlements + hardened runtime
      execSync(
        `${prefix}codesign --force --sign -${idFlag} --options runtime --entitlements "${tmpPlist}" "${binaryPath}"`,
        { stdio: 'pipe' },
      );
    }
  } catch {
    // Fallback: plain ad-hoc signing without entitlements
    try {
      execSync(
        `${prefix}codesign --force --sign -${idFlag} "${binaryPath}"`,
        { stdio: 'pipe' },
      );
    } catch { /* codesign is best-effort — continue silently */ }
  } finally {
    try { fs.unlinkSync(tmpPlist); } catch { /* ignore */ }
  }
}

/**
 * Download and install a SEA binary release from GitHub Releases.
 *
 * Mirrors the logic in `tools/sea/install.sh`:
 * 1. Download the platform-specific tarball
 * 2. Verify SHA-256 checksum
 * 3. Extract and install binaries + support files
 * 4. Sign binaries on macOS
 */
export async function downloadAndInstallSEARemote(
  version: string,
  repo = DEFAULT_GITHUB_REPO,
  onProgress?: (step: string) => void,
): Promise<DownloadResult> {
  const platform = detectSEAPlatform();
  const arch = detectSEAArch();
  const archiveName = `agenshield-${version}-${platform}-${arch}.tar.gz`;
  const baseUrl = `https://github.com/${repo}/releases/download/v${version}`;
  const archiveUrl = `${baseUrl}/${archiveName}`;
  const checksumUrl = `${baseUrl}/checksums.sha256`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenshield-sea-'));
  const archivePath = path.join(tmpDir, archiveName);
  const checksumPath = path.join(tmpDir, 'checksums.sha256');
  const extractDir = path.join(tmpDir, 'extracted');

  try {
    // Step 1: Download archive
    onProgress?.(`Downloading ${archiveName}...`);
    await shellAsync(
      `curl -fSL --retry 3 --retry-delay 2 -o "${archivePath}" "${archiveUrl}"`,
      { timeout: 300_000 },
    );

    // Step 2: Download checksums and verify
    onProgress?.('Verifying checksum...');
    try {
      await shellAsync(
        `curl -fSL --retry 3 --retry-delay 2 -o "${checksumPath}" "${checksumUrl}"`,
        { timeout: 30_000 },
      );

      // Extract expected hash for our archive
      const checksumContent = fs.readFileSync(checksumPath, 'utf-8');
      const expectedLine = checksumContent.split('\n').find((l) => l.includes(archiveName));
      if (expectedLine) {
        const expectedHash = expectedLine.split(/\s+/)[0];
        const actualResult = await shellAsync(
          `shasum -a 256 "${archivePath}" | awk '{print $1}'`,
          { timeout: 30_000 },
        );
        const actualHash = actualResult.stdout.trim();
        if (actualHash !== expectedHash) {
          return {
            success: false,
            version,
            error: `Checksum mismatch: expected ${expectedHash}, got ${actualHash}`,
          };
        }
      }
    } catch {
      // Checksum file may not exist for all releases — warn but continue
      onProgress?.('Warning: could not verify checksum, continuing...');
    }

    // Step 3: Extract
    onProgress?.('Extracting...');
    fs.mkdirSync(extractDir, { recursive: true });
    await shellAsync(
      `tar -xzf "${archivePath}" -C "${extractDir}"`,
      { timeout: 60_000 },
    );

    // Step 4: Install binaries
    const binDir = getBinDir();
    const libexecDir = path.join(AGENSHIELD_HOME, 'libexec');
    const libDir = path.join(AGENSHIELD_HOME, 'lib', `v${version}`);
    // Only use sudo when libexec already exists as root-owned (upgrade path)
    const needsSudo = isRootOwned(libexecDir);
    fs.mkdirSync(binDir, { recursive: true });
    if (needsSudo) {
      execSync(`sudo mkdir -p "${libexecDir}"`, { stdio: 'pipe' });
    } else {
      fs.mkdirSync(libexecDir, { recursive: true });
    }
    fs.mkdirSync(libDir, { recursive: true });

    // CLI binary → bin/
    onProgress?.('Installing binaries...');
    const cliBin = path.join(extractDir, 'agenshield');
    if (fs.existsSync(cliBin)) {
      fs.copyFileSync(cliBin, path.join(binDir, 'agenshield'));
      fs.chmodSync(path.join(binDir, 'agenshield'), 0o755);
      await signBinaryHardened(path.join(binDir, 'agenshield'));
    }

    // Daemon + Broker → libexec/
    for (const name of ['agenshield-daemon', 'agenshield-broker']) {
      const src = path.join(extractDir, name);
      if (fs.existsSync(src)) {
        const dest = path.join(libexecDir, name);
        if (needsSudo) {
          execSync(`sudo cp "${src}" "${dest}"`, { stdio: 'pipe' });
          execSync(`sudo chmod 755 "${dest}"`, { stdio: 'pipe' });
          await signBinaryHardened(dest, { sudo: true });
        } else {
          fs.copyFileSync(src, dest);
          fs.chmodSync(dest, 0o755);
          await signBinaryHardened(dest);
        }
      }
    }

    // On upgrade with root-owned libexec, preserve root:wheel ownership
    if (needsSudo && process.platform === 'darwin') {
      try {
        execSync(`sudo chown -R root:wheel "${libexecDir}"`, { stdio: 'pipe' });
      } catch { /* best-effort */ }
    }

    // Step 5: Copy support directories
    const supportDirs = ['native', 'workers', 'interceptor', 'client', 'ui-assets'];
    for (const dir of supportDirs) {
      const srcDir = path.join(extractDir, dir);
      if (fs.existsSync(srcDir)) {
        const destDir = path.join(libDir, dir);
        fs.mkdirSync(destDir, { recursive: true });
        onProgress?.(`Installing ${dir}...`);
        execSync(`cp -R "${srcDir}/." "${destDir}/"`, { stdio: 'pipe' });
      }
    }

    // Step 5b: Extract macOS menu bar app (if present in archive)
    const macAppSrc = path.join(extractDir, 'AgenShield.app');
    if (fs.existsSync(macAppSrc)) {
      const appsDir = path.join(AGENSHIELD_HOME, 'apps');
      fs.mkdirSync(appsDir, { recursive: true });
      const destApp = path.join(appsDir, 'AgenShield.app');
      // Remove old app bundle if present
      if (fs.existsSync(destApp)) {
        fs.rmSync(destApp, { recursive: true, force: true });
      }
      execSync(`cp -R "${macAppSrc}" "${destApp}"`, { stdio: 'pipe' });
      onProgress?.('Installed AgenShield.app');
    }

    // Step 6: Write extraction stamp
    fs.writeFileSync(path.join(libDir, '.extracted'), `${version}:wius`);

    onProgress?.('Installation complete');
    return { success: true, version };
  } catch (err) {
    return {
      success: false,
      version,
      error: (err as Error).message,
    };
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// npm → ~/.agenshield/apps extraction
// ---------------------------------------------------------------------------

/**
 * Extract the AgenShield.app from the sandbox npm package into
 * `~/.agenshield/apps/AgenShield.app`.
 *
 * This bridges the gap between the npm-pack install path (where the .app
 * lives inside `node_modules/@agenshield/sandbox/macos-app/`) and the
 * menu bar installer which expects it at `~/.agenshield/apps/`.
 *
 * @param distDir - The installation dist directory (e.g. `~/.agenshield/dist/`)
 * @returns `true` if the app was extracted, `false` if not found or not macOS.
 */
export function extractMacAppFromSandbox(distDir: string): boolean {
  if (process.platform !== 'darwin') return false;

  const sandboxAppPath = path.join(
    distDir, 'node_modules', '@agenshield', 'sandbox', 'macos-app', 'AgenShield.app',
  );

  if (!fs.existsSync(sandboxAppPath)) return false;

  const appsDir = path.join(AGENSHIELD_HOME, 'apps');
  fs.mkdirSync(appsDir, { recursive: true });

  const destApp = path.join(appsDir, 'AgenShield.app');
  // Remove old app bundle if present
  if (fs.existsSync(destApp)) {
    fs.rmSync(destApp, { recursive: true, force: true });
  }

  execSync(`cp -R "${sandboxAppPath}" "${destApp}"`, { stdio: 'pipe' });
  return true;
}

/** Path to the SEA binary in ~/.agenshield/bin/ */
export function getSEABinaryPath(): string {
  return path.join(getBinDir(), 'agenshield');
}

/**
 * Install pre-built SEA binaries from `dist/sea/` into `~/.agenshield/`.
 *
 * Multi-binary layout:
 *   ~/.agenshield/bin/agenshield              (CLI — on PATH)
 *   ~/.agenshield/libexec/agenshield-daemon   (Daemon — internal)
 *   ~/.agenshield/libexec/agenshield-broker   (Broker — internal)
 *
 * This copies already-built artifacts — it does NOT rebuild from source.
 * The binaries must have been built beforehand (e.g. via `tools/sea/build-all.mts`).
 */
export async function buildAndInstallSEAFromLocal(
  repoRoot: string,
  onProgress?: (step: string) => void,
): Promise<DownloadResult> {
  try {
    // Read version — prefer dist/sea/VERSION, fall back to libs/cli/package.json
    let version = 'unknown';
    const versionFilePath = path.join(repoRoot, 'dist', 'sea', 'VERSION');
    try {
      version = fs.readFileSync(versionFilePath, 'utf-8').trim();
    } catch {
      try {
        const cliPkg = JSON.parse(
          fs.readFileSync(path.join(repoRoot, 'libs', 'cli', 'package.json'), 'utf-8'),
        );
        version = cliPkg.version || 'unknown';
      } catch { /* ignore */ }
    }

    // Validate all pre-built binaries exist
    const binaries = [
      { name: 'agenshield', app: 'cli-bin' },
      { name: 'agenshield-daemon', app: 'daemon-bin' },
      { name: 'agenshield-broker', app: 'broker-bin' },
    ];

    const distSea = path.join(repoRoot, 'dist', 'sea');
    for (const bin of binaries) {
      const binPath = path.join(distSea, 'apps', bin.app, bin.name);
      if (!fs.existsSync(binPath)) {
        return {
          success: false,
          version,
          error: `Pre-built binary not found at ${binPath}. Run the SEA build first.`,
        };
      }
    }

    // Step 1: Copy binaries — CLI to bin/, daemon+broker to libexec/
    const binDir = getBinDir();
    const libexecDir = path.join(AGENSHIELD_HOME, 'libexec');
    // Only use sudo when libexec already exists as root-owned (upgrade path)
    const needsSudo = isRootOwned(libexecDir);
    fs.mkdirSync(binDir, { recursive: true });
    if (needsSudo) {
      execSync(`sudo mkdir -p "${libexecDir}"`, { stdio: 'pipe' });
    } else {
      fs.mkdirSync(libexecDir, { recursive: true });
    }

    onProgress?.('Installing binaries...');
    for (const bin of binaries) {
      const srcBinary = path.join(distSea, 'apps', bin.app, bin.name);
      const destDir = bin.name === 'agenshield' ? binDir : libexecDir;
      const destBinary = path.join(destDir, bin.name);
      if (destDir === libexecDir && needsSudo) {
        execSync(`sudo cp "${srcBinary}" "${destBinary}"`, { stdio: 'pipe' });
        execSync(`sudo chmod 755 "${destBinary}"`, { stdio: 'pipe' });
      } else {
        fs.copyFileSync(srcBinary, destBinary);
        fs.chmodSync(destBinary, 0o755);
      }
      // Remove quarantine (binaries are already signed during build)
      if (process.platform === 'darwin') {
        const prefix = destDir === libexecDir && needsSudo ? 'sudo ' : '';
        try {
          execSync(`${prefix}xattr -d com.apple.quarantine "${destBinary}" 2>/dev/null`, { stdio: 'pipe' });
        } catch { /* may not have the attribute */ }
      }
    }

    // On upgrade with root-owned libexec, preserve root:wheel ownership
    if (needsSudo && process.platform === 'darwin') {
      try {
        execSync(`sudo chown -R root:wheel "${libexecDir}"`, { stdio: 'pipe' });
      } catch { /* best-effort */ }
    }

    // Step 2: Copy native modules
    const libDir = path.join(resolveHostHome(), '.agenshield', 'lib', `v${version}`);
    const nativeDir = path.join(libDir, 'native');
    fs.mkdirSync(nativeDir, { recursive: true });

    onProgress?.('Installing native modules...');
    const nativeSearchPaths = [
      path.join(repoRoot, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
      path.join(repoRoot, 'node_modules/better-sqlite3/prebuilds',
        `${process.platform}-${process.arch}`, 'better_sqlite3.node'),
    ];

    for (const searchPath of nativeSearchPaths) {
      if (fs.existsSync(searchPath)) {
        fs.copyFileSync(searchPath, path.join(nativeDir, 'better_sqlite3.node'));
        break;
      }
    }

    // Step 3: Copy worker scripts
    const daemonDistDir = path.join(distSea, 'apps', 'daemon-bin');
    const workersDir = path.join(daemonDistDir, 'workers');
    if (fs.existsSync(workersDir)) {
      const destWorkers = path.join(libDir, 'workers');
      fs.mkdirSync(destWorkers, { recursive: true });
      for (const file of fs.readdirSync(workersDir)) {
        fs.copyFileSync(path.join(workersDir, file), path.join(destWorkers, file));
      }
      onProgress?.('Installed worker scripts');
    }

    // Step 4: Copy interceptor scripts
    const interceptorDir = path.join(daemonDistDir, 'interceptor');
    if (fs.existsSync(interceptorDir)) {
      const destInterceptor = path.join(libDir, 'interceptor');
      fs.mkdirSync(destInterceptor, { recursive: true });
      for (const file of fs.readdirSync(interceptorDir)) {
        fs.copyFileSync(path.join(interceptorDir, file), path.join(destInterceptor, file));
      }
      onProgress?.('Installed interceptor scripts');
    }

    // Step 5: Copy UI assets
    onProgress?.('Installing UI assets...');
    const uiTarball = path.join(distSea, 'assets', 'ui-assets.tar.gz');
    const uiDistDir = path.join(repoRoot, 'dist', 'apps', 'shield-ui');
    const destUiDir = path.join(libDir, 'ui-assets');

    if (fs.existsSync(uiTarball)) {
      fs.mkdirSync(destUiDir, { recursive: true });
      execSync(`tar -xzf "${uiTarball}" -C "${destUiDir}"`, { stdio: 'pipe' });
    } else if (fs.existsSync(uiDistDir)) {
      fs.mkdirSync(destUiDir, { recursive: true });
      execSync(`cp -R "${uiDistDir}/." "${destUiDir}/"`, { stdio: 'pipe' });
    }

    // Step 5b: Copy macOS menu bar app (if present in build output or archive)
    if (process.platform === 'darwin') {
      const macAppPaths = [
        path.join(repoRoot, 'dist', 'apps', 'shield-macos', 'Release', 'AgenShield.app'),
        path.join(distSea, 'staging', 'AgenShield.app'),
      ];
      for (const macAppSrc of macAppPaths) {
        if (fs.existsSync(macAppSrc)) {
          const appsDir = path.join(AGENSHIELD_HOME, 'apps');
          fs.mkdirSync(appsDir, { recursive: true });
          const destApp = path.join(appsDir, 'AgenShield.app');
          if (fs.existsSync(destApp)) {
            fs.rmSync(destApp, { recursive: true, force: true });
          }
          execSync(`cp -R "${macAppSrc}" "${destApp}"`, { stdio: 'pipe' });
          onProgress?.('Installed AgenShield.app');
          break;
        }
      }
    }

    // Step 6: Write extraction stamp
    fs.writeFileSync(path.join(libDir, '.extracted'), `${version}:wiu`);

    return { success: true, version };
  } catch (err) {
    return {
      success: false,
      version: 'unknown',
      error: (err as Error).message,
    };
  }
}

/**
 * Install SEA binaries from a pre-extracted archive directory (flat layout).
 *
 * Expected directory layout (from tar.gz extraction):
 *   sourceDir/agenshield
 *   sourceDir/agenshield-daemon
 *   sourceDir/agenshield-broker
 *   sourceDir/native/better_sqlite3.node
 *   sourceDir/workers/
 *   sourceDir/interceptor/
 *   sourceDir/client/
 *   sourceDir/ui-assets/
 *   sourceDir/AgenShield.app/  (macOS only)
 */
export async function installSEAFromDir(
  sourceDir: string,
  version: string,
  onProgress?: (step: string) => void,
): Promise<DownloadResult> {
  try {
    // Validate binaries exist
    const binaries = [
      { name: 'agenshield', target: 'bin' as const },
      { name: 'agenshield-daemon', target: 'libexec' as const },
      { name: 'agenshield-broker', target: 'libexec' as const },
    ];

    for (const bin of binaries) {
      const binPath = path.join(sourceDir, bin.name);
      if (!fs.existsSync(binPath)) {
        return {
          success: false,
          version,
          error: `Binary not found: ${binPath}`,
        };
      }
    }

    // Step 1: Copy binaries
    const binDir = getBinDir();
    const libexecDir = path.join(AGENSHIELD_HOME, 'libexec');
    const needsSudo = isRootOwned(libexecDir);

    fs.mkdirSync(binDir, { recursive: true });
    if (needsSudo) {
      execSync(`sudo mkdir -p "${libexecDir}"`, { stdio: 'pipe' });
    } else {
      fs.mkdirSync(libexecDir, { recursive: true });
    }

    onProgress?.('Installing binaries...');
    for (const bin of binaries) {
      const srcBinary = path.join(sourceDir, bin.name);
      const destDir = bin.target === 'bin' ? binDir : libexecDir;
      const destBinary = path.join(destDir, bin.name);
      if (destDir === libexecDir && needsSudo) {
        execSync(`sudo cp "${srcBinary}" "${destBinary}"`, { stdio: 'pipe' });
        execSync(`sudo chmod 755 "${destBinary}"`, { stdio: 'pipe' });
      } else {
        fs.copyFileSync(srcBinary, destBinary);
        fs.chmodSync(destBinary, 0o755);
      }
      // Remove quarantine (binaries are already signed during build)
      if (process.platform === 'darwin') {
        const prefix = destDir === libexecDir && needsSudo ? 'sudo ' : '';
        try {
          execSync(`${prefix}xattr -d com.apple.quarantine "${destBinary}" 2>/dev/null`, { stdio: 'pipe' });
        } catch { /* may not have the attribute */ }
      }
    }

    // Preserve root:wheel ownership on upgrade
    if (needsSudo && process.platform === 'darwin') {
      try {
        execSync(`sudo chown -R root:wheel "${libexecDir}"`, { stdio: 'pipe' });
      } catch { /* best-effort */ }
    }

    // Step 2: Copy native modules
    const hostHome = resolveHostHome();
    const libDir = path.join(hostHome, '.agenshield', 'lib', `v${version}`);

    const srcNativeDir = path.join(sourceDir, 'native');
    if (fs.existsSync(srcNativeDir)) {
      const destNativeDir = path.join(libDir, 'native');
      fs.mkdirSync(destNativeDir, { recursive: true });
      for (const file of fs.readdirSync(srcNativeDir)) {
        const destFile = path.join(destNativeDir, file);
        fs.copyFileSync(path.join(srcNativeDir, file), destFile);
      }
      // Remove quarantine from native modules
      if (process.platform === 'darwin') {
        try {
          execSync(`xattr -dr com.apple.quarantine "${destNativeDir}" 2>/dev/null`, { stdio: 'pipe' });
        } catch { /* may not have the attribute */ }
      }
      onProgress?.('Installed native modules');
    }

    // Step 3: Copy worker scripts
    const srcWorkersDir = path.join(sourceDir, 'workers');
    if (fs.existsSync(srcWorkersDir)) {
      const destWorkersDir = path.join(libDir, 'workers');
      fs.mkdirSync(destWorkersDir, { recursive: true });
      for (const file of fs.readdirSync(srcWorkersDir)) {
        fs.copyFileSync(path.join(srcWorkersDir, file), path.join(destWorkersDir, file));
      }
      onProgress?.('Installed worker scripts');
    }

    // Step 4: Copy interceptor scripts
    const srcInterceptorDir = path.join(sourceDir, 'interceptor');
    if (fs.existsSync(srcInterceptorDir)) {
      const destInterceptorDir = path.join(libDir, 'interceptor');
      fs.mkdirSync(destInterceptorDir, { recursive: true });
      for (const file of fs.readdirSync(srcInterceptorDir)) {
        fs.copyFileSync(path.join(srcInterceptorDir, file), path.join(destInterceptorDir, file));
      }
      onProgress?.('Installed interceptor scripts');
    }

    // Step 5: Copy client scripts
    const srcClientDir = path.join(sourceDir, 'client');
    if (fs.existsSync(srcClientDir)) {
      const destClientDir = path.join(libDir, 'client');
      fs.mkdirSync(destClientDir, { recursive: true });
      for (const file of fs.readdirSync(srcClientDir)) {
        fs.copyFileSync(path.join(srcClientDir, file), path.join(destClientDir, file));
      }
      onProgress?.('Installed client scripts');
    }

    // Step 6: Copy UI assets
    const srcUiDir = path.join(sourceDir, 'ui-assets');
    if (fs.existsSync(srcUiDir)) {
      const destUiDir = path.join(libDir, 'ui-assets');
      fs.mkdirSync(destUiDir, { recursive: true });
      execSync(`cp -R "${srcUiDir}/." "${destUiDir}/"`, { stdio: 'pipe' });
      onProgress?.('Installed UI assets');
    }

    // Step 7: Copy macOS menu bar app
    if (process.platform === 'darwin') {
      const srcApp = path.join(sourceDir, 'AgenShield.app');
      if (fs.existsSync(srcApp)) {
        const appsDir = path.join(AGENSHIELD_HOME, 'apps');
        fs.mkdirSync(appsDir, { recursive: true });
        const destApp = path.join(appsDir, 'AgenShield.app');
        if (fs.existsSync(destApp)) {
          fs.rmSync(destApp, { recursive: true, force: true });
        }
        execSync(`cp -R "${srcApp}" "${destApp}"`, { stdio: 'pipe' });
        // Remove quarantine from the entire app bundle
        try {
          execSync(`xattr -dr com.apple.quarantine "${destApp}" 2>/dev/null`, { stdio: 'pipe' });
        } catch { /* may not have the attribute */ }
        onProgress?.('Installed AgenShield.app');
      }
    }

    // Step 8: Write extraction stamp
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, '.extracted'), `${version}:wius`);

    return { success: true, version };
  } catch (err) {
    return {
      success: false,
      version,
      error: (err as Error).message,
    };
  }
}
