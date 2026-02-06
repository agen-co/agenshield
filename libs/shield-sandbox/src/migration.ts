/**
 * File migration utilities for OpenClaw isolation
 *
 * Handles moving OpenClaw installation files from the original
 * user to the sandboxed user.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { SandboxUser, DirectoryStructure } from './types';

export interface MigrationSource {
  /** Installation method: npm or git */
  method: 'npm' | 'git';
  /** Path to the package directory */
  packagePath: string;
  /** Path to the binary */
  binaryPath?: string;
  /** Path to the config directory */
  configPath?: string;
  /** Path to the git repo (for git installs) */
  gitRepoPath?: string;
}

export interface MigrationResult {
  success: boolean;
  error?: string;
  /** New paths after migration */
  newPaths?: {
    packagePath: string;
    binaryPath: string;
    configPath: string;
  };
}

/**
 * Execute a command with sudo
 */
function sudoExec(cmd: string): { success: boolean; output?: string; error?: string } {
  try {
    const output = execSync(`sudo ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output: output.trim() };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    return { success: false, error: error.stderr || error.message || 'Unknown error' };
  }
}

/**
 * Copy directory contents recursively with sudo (copies INTO dest, not nesting)
 */
function sudoCopyDir(src: string, dest: string): { success: boolean; error?: string } {
  return sudoExec(`cp -R "${src}/." "${dest}/"`);
}

/**
 * Create the OpenClaw wrapper script for the sandbox user
 */
function createOpenClawWrapper(
  user: SandboxUser,
  dirs: DirectoryStructure,
  method: 'npm' | 'git'
): { success: boolean; error?: string } {
  const wrapperPath = path.join(dirs.binDir, 'openclaw');

  // Resolve entry point from package.json bin field so it works both
  // in monorepo (dist/entry.js) and when published (entry.js at root)
  let entryPath = path.join(dirs.packageDir, 'dist', 'entry.js'); // fallback
  try {
    const pkgJsonPath = path.join(dirs.packageDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    const binEntry = typeof pkg.bin === 'string'
      ? pkg.bin
      : pkg.bin?.['openclaw'] || './dist/entry.js';
    entryPath = path.resolve(dirs.packageDir, binEntry);
  } catch {
    // package.json not found or unreadable, use fallback
  }

  const wrapperContent = `#!/bin/bash
set -euo pipefail
# Avoid getcwd errors when cwd is inaccessible
cd ~ 2>/dev/null || cd /
# Resolve node from wrapper's own bin directory
AGENT_BIN="$(cd "$(dirname "$0")" && pwd)"
exec "\${AGENT_BIN}/node" "${entryPath}" "$@"
`;

  // Write wrapper to temp file
  const tempPath = '/tmp/openclaw-wrapper';
  try {
    fs.writeFileSync(tempPath, wrapperContent, { mode: 0o755 });
  } catch (err) {
    return { success: false, error: `Failed to write wrapper: ${err}` };
  }

  // Move to final location
  let result = sudoExec(`mv "${tempPath}" "${wrapperPath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to install wrapper: ${result.error}` };
  }

  // Set ownership and permissions
  result = sudoExec(`chown ${user.username}:${user.gid} "${wrapperPath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set wrapper ownership: ${result.error}` };
  }

  result = sudoExec(`chmod 755 "${wrapperPath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set wrapper permissions: ${result.error}` };
  }

  return { success: true };
}

/**
 * Migrate npm-based OpenClaw installation to sandbox user
 */
export function migrateNpmInstall(
  source: MigrationSource,
  user: SandboxUser,
  dirs: DirectoryStructure
): MigrationResult {
  // Copy package directory
  let result = sudoCopyDir(source.packagePath, dirs.packageDir);
  if (!result.success) {
    return { success: false, error: `Failed to copy package: ${result.error}` };
  }

  // Copy config if exists (but without secrets)
  if (source.configPath && fs.existsSync(source.configPath)) {
    result = sudoCopyDir(source.configPath, dirs.configDir);
    if (!result.success) {
      return { success: false, error: `Failed to copy config: ${result.error}` };
    }

    // Remove any secrets files from the copied config
    sudoExec(`rm -f "${dirs.configDir}/secrets.json" 2>/dev/null`);
    sudoExec(`rm -f "${dirs.configDir}/.env" 2>/dev/null`);
    sudoExec(`rm -f "${dirs.configDir}/credentials.json" 2>/dev/null`);

    // Remove skills/ — skills must go through quarantine/approval system
    sudoExec(`rm -rf "${dirs.configDir}/skills" 2>/dev/null`);

    // Ensure skill watcher is always enabled in the migrated config
    injectSkillWatcherSetting(dirs.configDir);
  }

  // Set ownership of all copied files
  result = sudoExec(`chown -R ${user.username}:${user.gid} "${dirs.packageDir}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set package ownership: ${result.error}` };
  }

  if (fs.existsSync(dirs.configDir)) {
    result = sudoExec(`chown -R ${user.username}:${user.gid} "${dirs.configDir}"`);
    if (!result.success) {
      return { success: false, error: `Failed to set config ownership: ${result.error}` };
    }
  }

  // Create the wrapper script
  const wrapperResult = createOpenClawWrapper(user, dirs, 'npm');
  if (!wrapperResult.success) {
    return { success: false, error: wrapperResult.error };
  }

  return {
    success: true,
    newPaths: {
      packagePath: dirs.packageDir,
      binaryPath: path.join(dirs.binDir, 'openclaw'),
      configPath: dirs.configDir,
    },
  };
}

/**
 * Migrate git-based OpenClaw installation to sandbox user
 */
export function migrateGitInstall(
  source: MigrationSource,
  user: SandboxUser,
  dirs: DirectoryStructure
): MigrationResult {
  const repoPath = source.gitRepoPath || source.packagePath;

  // Copy the entire git repo
  let result = sudoCopyDir(repoPath, dirs.packageDir);
  if (!result.success) {
    return { success: false, error: `Failed to copy repo: ${result.error}` };
  }

  // Copy config if exists (but without secrets)
  if (source.configPath && fs.existsSync(source.configPath)) {
    result = sudoCopyDir(source.configPath, dirs.configDir);
    if (!result.success) {
      return { success: false, error: `Failed to copy config: ${result.error}` };
    }

    // Remove any secrets files from the copied config
    sudoExec(`rm -f "${dirs.configDir}/secrets.json" 2>/dev/null`);
    sudoExec(`rm -f "${dirs.configDir}/.env" 2>/dev/null`);
    sudoExec(`rm -f "${dirs.configDir}/credentials.json" 2>/dev/null`);

    // Remove skills/ — skills must go through quarantine/approval system
    sudoExec(`rm -rf "${dirs.configDir}/skills" 2>/dev/null`);

    // Ensure skill watcher is always enabled in the migrated config
    injectSkillWatcherSetting(dirs.configDir);
  }

  // Set ownership of all copied files
  result = sudoExec(`chown -R ${user.username}:${user.gid} "${dirs.packageDir}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set package ownership: ${result.error}` };
  }

  if (fs.existsSync(dirs.configDir)) {
    result = sudoExec(`chown -R ${user.username}:${user.gid} "${dirs.configDir}"`);
    if (!result.success) {
      return { success: false, error: `Failed to set config ownership: ${result.error}` };
    }
  }

  // Create the wrapper script
  const wrapperResult = createOpenClawWrapper(user, dirs, 'git');
  if (!wrapperResult.success) {
    return { success: false, error: wrapperResult.error };
  }

  return {
    success: true,
    newPaths: {
      packagePath: dirs.packageDir,
      binaryPath: path.join(dirs.binDir, 'openclaw'),
      configPath: dirs.configDir,
    },
  };
}

/**
 * Migrate OpenClaw installation to sandbox user
 */
export function migrateOpenClaw(
  source: MigrationSource,
  user: SandboxUser,
  dirs: DirectoryStructure
): MigrationResult {
  if (source.method === 'npm') {
    return migrateNpmInstall(source, user, dirs);
  } else {
    return migrateGitInstall(source, user, dirs);
  }
}

/**
 * Inject skillWatcher setting into a migrated config directory.
 * Writes to settings.json inside the config dir.
 */
function injectSkillWatcherSetting(configDir: string): void {
  const settingsPath = path.join(configDir, 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch {
    // Start fresh if unreadable
    settings = {};
  }
  settings.skillWatcher = { enabled: true };
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch {
    // Best-effort — may fail if dir is not writable yet
  }
}

/**
 * Create a Node.js wrapper in the sandbox user's bin directory
 */
export function createNodeWrapper(user: SandboxUser, dirs: DirectoryStructure): {
  success: boolean;
  error?: string;
} {
  // Find node binary: prefer sandbox copy, then agent NVM, then system
  let nodePath: string;
  const sandboxNodeBin = '/opt/agenshield/bin/node-bin';
  if (fs.existsSync(sandboxNodeBin)) {
    nodePath = sandboxNodeBin;
  } else {
    // Try NVM under agent home
    const nvmVersionsDir = path.join(user.homeDir, '.nvm', 'versions', 'node');
    let nvmNode: string | undefined;
    try {
      const versions = fs.readdirSync(nvmVersionsDir).sort();
      for (const v of versions.reverse()) {
        const candidate = path.join(nvmVersionsDir, v, 'bin', 'node');
        if (fs.existsSync(candidate)) {
          nvmNode = candidate;
          break;
        }
      }
    } catch {
      // NVM not installed for agent, fall through
    }
    if (nvmNode) {
      nodePath = nvmNode;
    } else {
      try {
        nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
      } catch {
        return { success: false, error: 'Node.js not found (checked /opt/agenshield/bin/node-bin, agent NVM, and system PATH)' };
      }
    }
  }

  // Create a wrapper that calls the system node
  const wrapperPath = path.join(dirs.binDir, 'node');
  const wrapperContent = `#!/bin/bash
exec "${nodePath}" "$@"
`;

  const tempPath = '/tmp/node-wrapper';
  try {
    fs.writeFileSync(tempPath, wrapperContent, { mode: 0o755 });
  } catch (err) {
    return { success: false, error: `Failed to write node wrapper: ${err}` };
  }

  let result = sudoExec(`mv "${tempPath}" "${wrapperPath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to install node wrapper: ${result.error}` };
  }

  result = sudoExec(`chown ${user.username}:${user.gid} "${wrapperPath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set node wrapper ownership: ${result.error}` };
  }

  return { success: true };
}
