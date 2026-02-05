/**
 * Custom Preset
 *
 * Preset for sandboxing arbitrary Node.js applications.
 * Requires user to specify the entry point.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  TargetPreset,
  PresetDetectionResult,
  MigrationContext,
  PresetMigrationResult,
} from './types.js';

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
 * Copy a directory recursively with sudo
 */
function sudoCopyDir(src: string, dest: string): { success: boolean; error?: string } {
  return sudoExec(`cp -R "${src}" "${dest}"`);
}

/**
 * Custom preset implementation
 */
export const customPreset: TargetPreset = {
  id: 'custom',
  name: 'Custom Node.js Application',
  description: 'Any Node.js application with specified entry point',

  requiredBins: ['node'],
  optionalBins: ['npm', 'npx', 'git', 'curl'],

  async detect(): Promise<PresetDetectionResult | null> {
    // Custom preset doesn't auto-detect - user must provide entry point
    return null;
  },

  async migrate(context: MigrationContext): Promise<PresetMigrationResult> {
    if (!context.entryPoint) {
      return { success: false, error: 'Entry point required for custom preset (--entry-point)' };
    }

    // Resolve to absolute path
    const entryPath = path.resolve(context.entryPoint);

    // Verify entry point exists
    if (!fs.existsSync(entryPath)) {
      return { success: false, error: `Entry point not found: ${entryPath}` };
    }

    // Get the directory containing the entry point
    const entryDir = path.dirname(entryPath);
    const entryFilename = path.basename(entryPath);

    // Copy the entire directory to the sandbox
    const result = sudoCopyDir(entryDir, context.directories.packageDir);
    if (!result.success) {
      return { success: false, error: `Failed to copy package: ${result.error}` };
    }

    // Set ownership of copied files
    let ownerResult = sudoExec(
      `chown -R ${context.agentUser.username}:${context.agentUser.gid} "${context.directories.packageDir}"`
    );
    if (!ownerResult.success) {
      return { success: false, error: `Failed to set ownership: ${ownerResult.error}` };
    }

    // Create wrapper script for the entry point
    const wrapperPath = path.join(context.directories.binDir, 'agent');
    const newEntryPath = path.join(context.directories.packageDir, entryFilename);

    const wrapperContent = `#!/bin/bash
set -euo pipefail
cd ~ 2>/dev/null || cd /
AGENT_BIN="$(cd "$(dirname "$0")" && pwd)"
cd "${context.directories.packageDir}"
exec "\${AGENT_BIN}/node" "${newEntryPath}" "$@"
`;

    // Write wrapper to temp file
    const tempPath = '/tmp/agent-wrapper';
    try {
      fs.writeFileSync(tempPath, wrapperContent, { mode: 0o755 });
    } catch (err) {
      return { success: false, error: `Failed to write wrapper: ${err}` };
    }

    // Move to final location
    let moveResult = sudoExec(`mv "${tempPath}" "${wrapperPath}"`);
    if (!moveResult.success) {
      return { success: false, error: `Failed to install wrapper: ${moveResult.error}` };
    }

    // Set ownership and permissions
    ownerResult = sudoExec(`chown ${context.agentUser.username}:${context.agentUser.gid} "${wrapperPath}"`);
    if (!ownerResult.success) {
      return { success: false, error: `Failed to set wrapper ownership: ${ownerResult.error}` };
    }

    const chmodResult = sudoExec(`chmod 755 "${wrapperPath}"`);
    if (!chmodResult.success) {
      return { success: false, error: `Failed to set wrapper permissions: ${chmodResult.error}` };
    }

    return {
      success: true,
      newPaths: {
        packagePath: context.directories.packageDir,
        binaryPath: wrapperPath,
      },
    };
  },

  getEntryCommand(context: MigrationContext): string {
    return `${context.directories.binDir}/agent`;
  },
};
