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
} from './types.js';
import { checkedExecAsRoot, checkedExecAsUser } from './install-helpers.js';
import { TargetAppInstallError } from '../errors.js';

/**
 * Claude Code preset implementation
 */
export const claudeCodePreset: TargetPreset = {
  id: 'claude-code',
  name: 'Claude Code',
  description: 'Anthropic Claude Code CLI agent',

  requiredBins: ['node', 'npm', 'git', 'bash'],
  optionalBins: ['npx', 'curl', 'python3', 'pip', 'brew', 'ssh'],
  policyPresetIds: ['claudecode'],

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
    try {
      // 1. Install Claude Code (0-50%)
      ctx.onProgress('installing_claude', 15, 'Installing Claude Code...');
      ctx.onLog('Step 1/5: Installing Claude Code via installer');
      try {
        await checkedExecAsUser(ctx, [
          `export HOME="${ctx.agentHome}"`,
          'curl -fsSL https://claude.ai/install.sh | bash',
        ].join(' && '), 'install_claude', 180_000);
      } catch (err) {
        throw new TargetAppInstallError((err as Error).message, 'claude-code');
      }

      // 2. Verify binary (50-55%)
      ctx.onProgress('verifying_binary', 52, 'Verifying Claude Code binary...');
      ctx.onLog('Step 2/5: Verifying Claude Code installation');
      const verifyResult = await ctx.execAsUser(
        `export HOME="${ctx.agentHome}" && export PATH="${ctx.agentHome}/.claude/local/bin:$PATH" && claude --version`,
        { timeout: 15_000 },
      );
      const installedVersion = verifyResult.success ? verifyResult.output.trim().split('\n')[0] : undefined;
      if (!verifyResult.success) {
        ctx.onLog('Warning: claude --version failed, but install may have succeeded');
      } else {
        ctx.onLog(`Claude Code version: ${installedVersion}`);
      }

      // 3. Stop host Claude (55-65%)
      ctx.onProgress('stopping_host', 58, 'Stopping host Claude Code processes...');
      ctx.onLog('Step 3/5: Stopping host Claude Code processes');
      await ctx.execAsRoot(
        `pkill -f "claude" -u $(id -u ${ctx.hostUsername}) 2>/dev/null; true`,
        { timeout: 15_000 },
      );

      // 4. Copy host config (65-80%)
      ctx.onProgress('copying_config', 70, 'Copying host configuration...');
      ctx.onLog('Step 4/5: Copying host Claude Code configuration');
      const hostConfigDir = `/Users/${ctx.hostUsername}/.claude`;
      const agentConfigDir = `${ctx.agentHome}/.claude`;
      await ctx.execAsRoot([
        `if [ -d "${hostConfigDir}" ]; then`,
        // Copy config files but preserve the agent's own binaries
        `  for item in "${hostConfigDir}"/*; do`,
        '    base=$(basename "$item")',
        // Skip local/bin and downloads dirs (agent has its own)
        '    if [ "$base" = "local" ] || [ "$base" = "downloads" ]; then continue; fi',
        `    cp -a "$item" "${agentConfigDir}/$base" 2>/dev/null || true`,
        '  done',
        `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${agentConfigDir}"`,
        // Rewrite paths in config files
        `  find "${agentConfigDir}" -name "*.json" -exec sed -i '' 's|/Users/${ctx.hostUsername}|${ctx.agentHome}|g' {} + 2>/dev/null || true`,
        'fi',
      ].join('\n'), { timeout: 30_000 });

      // 5. Done (80-100%)
      ctx.onProgress('complete', 100, 'Claude Code installation complete');
      ctx.onLog('Step 5/5: Claude Code installation complete');

      return {
        success: true,
        appBinaryPath: `${ctx.agentHome}/.claude/local/bin/claude`,
        version: installedVersion,
      };
    } catch (err) {
      const message = (err as Error).message;
      const step = (err as { step?: string }).step ?? 'unknown';
      return { success: false, failedStep: step, error: message };
    }
  },
};
