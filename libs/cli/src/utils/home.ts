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
import { isSEA } from '@agenshield/ipc';

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
  '@agenshield/integrations': 'libs/shield-integrations',
  '@agenshield/interceptor': 'libs/shield-interceptor',
  '@agenshield/ipc': 'libs/shield-ipc',
  '@agenshield/patcher': 'libs/shield-patcher',
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
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(libexecDir, { recursive: true });

    onProgress?.('Installing binaries...');
    for (const bin of binaries) {
      const srcBinary = path.join(distSea, 'apps', bin.app, bin.name);
      const destDir = bin.name === 'agenshield' ? binDir : libexecDir;
      const destBinary = path.join(destDir, bin.name);
      fs.copyFileSync(srcBinary, destBinary);
      fs.chmodSync(destBinary, 0o755);
    }

    // Step 2: Copy native modules
    const libDir = path.join(os.homedir(), '.agenshield', 'lib', `v${version}`);
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
