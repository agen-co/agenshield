/**
 * OpenClaw Preset
 *
 * Preset for detecting and migrating OpenClaw AI coding agent installations.
 * Supports both npm global and git clone installations.
 */

import * as path from 'node:path';
import type {
  TargetPreset,
  PresetDetectionResult,
  MigrationContext,
  PresetMigrationResult,
  InstallContext,
  InstallResult,
} from '../types.js';
import type { MigrationScanResult } from '@agenshield/ipc';
import { detectOpenClaw } from '../../detection/detect.js';
import { scanHost } from '../../detection/host-scanner.js';
import { migrateOpenClaw, type MigrationSource } from '../../backup/migration.js';
import type { SandboxUser, DirectoryStructure as LegacyDirectoryStructure } from '../../types.js';

/**
 * OpenClaw preset implementation
 */
export const openclawPreset: TargetPreset = {
  id: 'openclaw',
  name: 'OpenClaw',
  description: 'AI coding agent (auto-detected via npm or git)',

  requiredBins: ['node', 'npm', 'npx', 'git', 'curl', 'bash', 'shieldctl'],
  optionalBins: ['wget', 'ssh', 'scp', 'python3', 'pip', 'brew'],
  policyPresetIds: ['openclaw'],
  shellFeatures: { homebrew: true, nvm: true },
  seatbeltDenyPaths: ['.openclaw'],

  async detect(): Promise<PresetDetectionResult | null> {
    const result = detectOpenClaw();

    if (!result.installation.found) {
      // Binary not found, but config dir may exist (e.g. skills on disk without openclaw installed)
      if (result.installation.configPath) {
        return { found: false, configPath: result.installation.configPath };
      }
      return null;
    }

    return {
      found: true,
      version: result.installation.version,
      packagePath: result.installation.packagePath,
      binaryPath: result.installation.binaryPath,
      configPath: result.installation.configPath,
      method: result.installation.method === 'unknown' ? undefined : result.installation.method,
    };
  },

  async scan(detection: PresetDetectionResult): Promise<MigrationScanResult | null> {
    // Build the config JSON path from the detection config directory
    const configJsonPath = detection.configPath
      ? path.join(detection.configPath, 'openclaw.json')
      : undefined;

    return scanHost({ configPath: configJsonPath });
  },

  async migrate(context: MigrationContext): Promise<PresetMigrationResult> {
    if (!context.detection?.packagePath) {
      return { success: false, error: 'OpenClaw package path not detected' };
    }

    // Convert to legacy types for existing migration function
    const source: MigrationSource = {
      method: (context.detection.method as 'npm' | 'git') || 'npm',
      packagePath: context.detection.packagePath,
      binaryPath: context.detection.binaryPath,
      configPath: context.detection.configPath,
      selection: context.selection,
    };

    const user: SandboxUser = {
      username: context.agentUser.username,
      uid: context.agentUser.uid,
      gid: context.agentUser.gid,
      homeDir: context.agentUser.home,
      shell: context.agentUser.shell,
    };

    const dirs: LegacyDirectoryStructure = {
      binDir: context.directories.binDir,
      wrappersDir: context.directories.wrappersDir,
      configDir: context.directories.configDir,
      packageDir: context.directories.packageDir,
      npmDir: context.directories.npmDir,
    };

    // Use existing migration logic
    const result = migrateOpenClaw(source, user, dirs);

    return {
      success: result.success,
      error: result.error,
      newPaths: result.newPaths,
    };
  },

  getEntryCommand(context: MigrationContext): string {
    return `${context.directories.binDir}/openclaw`;
  },

  async install(ctx: InstallContext): Promise<InstallResult> {
    const { runPipeline } = await import('../runner.js');
    const { getOpenclawPipeline } = await import('./pipeline.js');

    const version = ctx.requestedVersion ?? ctx.detection?.version ?? 'latest';
    const result = await runPipeline(getOpenclawPipeline(), ctx, { version });

    if (result.success) {
      // Get the installed binary path
      const binPathResult = await ctx.execAsUser(
        'which openclaw',
        { timeout: 10_000 },
      );

      return {
        ...result,
        appBinaryPath: binPathResult.success ? binPathResult.output.trim() : undefined,
        gatewayPlistPath: `/Library/LaunchDaemons/com.agenshield.${ctx.profileBaseName}.gateway.plist`,
        version,
        manifestEntries: result.manifestEntries,
      };
    }

    return { ...result, manifestEntries: result.manifestEntries };
  },
};
