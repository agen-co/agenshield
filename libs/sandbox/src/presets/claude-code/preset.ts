/**
 * Claude Code Preset
 *
 * Preset for detecting Anthropic Claude Code CLI agent installations.
 * Claude Code is a Node.js-based CLI agent installed via npm.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  TargetPreset,
  PresetDetectionResult,
  MigrationContext,
  PresetMigrationResult,
  InstallContext,
  InstallResult,
} from '../types.js';
import { buildClaudeSearchPath } from './claude-paths.js';

/**
 * Claude Code preset implementation
 */
export const claudeCodePreset: TargetPreset = {
  id: 'claude-code',
  name: 'Claude Code',
  description: 'Anthropic Claude Code CLI agent',

  requiredBins: ['node', 'npm', 'git', 'bash', 'curl'],
  optionalBins: ['npx', 'python3', 'pip', 'brew', 'ssh'],
  policyPresetIds: ['claudecode'],
  shellFeatures: {},
  seatbeltDenyPaths: ['.claude', '.local'],

  async detect(): Promise<PresetDetectionResult | null> {
    let binaryPath: string | undefined;
    let version: string | undefined;
    let configPath: string | undefined;
    let method: 'npm' | 'binary' | undefined;

    // 1. Find the claude binary
    try {
      binaryPath = execSync('which claude', { encoding: 'utf-8', timeout: 5_000 }).trim();
    } catch {
      // Not found in PATH
    }

    if (!binaryPath) return null;

    // 2. Get version
    try {
      const versionOutput = execSync('claude --version 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 10_000,
      }).trim();
      // Version output may be multi-line; take first line
      version = versionOutput.split('\n')[0]?.trim();
    } catch {
      // Version check failed — still report as detected
    }

    // 3. Determine installation method
    try {
      const npmRoot = execSync('npm root -g', { encoding: 'utf-8', timeout: 5_000 }).trim();
      const claudeNpmPath = path.join(npmRoot, '@anthropic-ai', 'claude-code');
      if (fs.existsSync(claudeNpmPath)) {
        method = 'npm';
      }
    } catch {
      // Not an npm install
    }

    if (!method) {
      method = 'binary';
    }

    // 4. Check for config directory
    const homeDir = process.env['HOME'] || '';
    const claudeConfigDir = path.join(homeDir, '.claude');
    if (fs.existsSync(claudeConfigDir)) {
      configPath = claudeConfigDir;
    }

    return {
      found: true,
      version,
      binaryPath,
      configPath,
      method,
    };
  },

  async migrate(context: MigrationContext): Promise<PresetMigrationResult> {
    // Copy Claude config to agent home
    const homeDir = process.env['HOME'] || '';
    const sourceConfigDir = path.join(homeDir, '.claude');
    const destConfigDir = path.join(context.agentUser.home, '.claude');

    try {
      if (fs.existsSync(sourceConfigDir)) {
        fs.cpSync(sourceConfigDir, destConfigDir, { recursive: true });
      }

      return {
        success: true,
        newPaths: {
          packagePath: context.agentUser.home,
          binaryPath: `${context.directories.binDir}/claude`,
          configPath: destConfigDir,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to migrate Claude Code config: ${(err as Error).message}`,
      };
    }
  },

  getEntryCommand(context: MigrationContext): string {
    return `${context.directories.binDir}/claude`;
  },

  async install(ctx: InstallContext): Promise<InstallResult> {
    const { runPipeline } = await import('../runner.js');
    const { getClaudeCodePipeline } = await import('./pipeline.js');

    const result = await runPipeline(getClaudeCodePipeline(), ctx);

    if (result.success) {
      const searchPath = buildClaudeSearchPath(ctx.agentHome);
      const binResult = await ctx.execAsUser(
        `export HOME="${ctx.agentHome}" && export PATH="${searchPath}:$PATH" && command -v claude`,
        { timeout: 10_000 },
      );
      return {
        ...result,
        appBinaryPath: binResult.success && binResult.output.trim()
          ? binResult.output.trim()
          : `${ctx.agentHome}/.local/bin/claude`,
        version: ctx.requestedVersion ?? ctx.detection?.version,
        manifestEntries: result.manifestEntries,
      };
    }

    return { ...result, manifestEntries: result.manifestEntries };
  },
};
