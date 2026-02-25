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
import { fileURLToPath } from 'node:url';

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
  return path.join(getDistDir(), 'src', 'cli.js');
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

// ---------------------------------------------------------------------------
// Local (monorepo) install helpers
// ---------------------------------------------------------------------------

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
 * Symlinks `~/.agenshield/dist` → `<repoRoot>/libs/cli/dist` so that
 * Node.js resolves the real path and walks up to find `libs/cli/node_modules/`
 * (where non-hoisted deps like `ink` live).
 */
export function installFromLocal(
  repoRoot: string,
  destDir?: string,
): DownloadResult {
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

    // Symlink entire dist dir so Node resolves modules from monorepo
    fs.symlinkSync(srcDir, dest, 'dir');

    // Read version from source package.json
    const pkgPath = path.join(srcDir, 'package.json');
    let version = 'unknown';
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.version) version = pkg.version;
      } catch { /* ignore */ }
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

  if (shell.endsWith('/zsh')) {
    rcFile = path.join(os.homedir(), '.zshrc');
  } else if (shell.endsWith('/bash')) {
    const bashProfile = path.join(os.homedir(), '.bash_profile');
    rcFile = fs.existsSync(bashProfile)
      ? bashProfile
      : path.join(os.homedir(), '.bashrc');
  } else if (shell.endsWith('/fish')) {
    // fish uses different syntax — skip auto-add, just return
    return { added: false, rcFile: '~/.config/fish/config.fish' };
  } else {
    rcFile = path.join(os.homedir(), '.profile');
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

// ---------------------------------------------------------------------------
// Shell rc PATH override (post-NVM)
// ---------------------------------------------------------------------------

export const PATH_OVERRIDE_START_MARKER = '# >>> AgenShield PATH override >>>';
export const PATH_OVERRIDE_END_MARKER = '# <<< AgenShield PATH override <<<';

/**
 * Resolve the shell rc file path for a given home/shell combination.
 */
function resolveShellRcPath(hostHome?: string, hostShell?: string): string {
  const home = hostHome || os.homedir();
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
