/**
 * OpenClaw Preset
 *
 * Preset for detecting and migrating OpenClaw AI coding agent installations.
 * Supports both npm global and git clone installations.
 */

import type {
  TargetPreset,
  PresetDetectionResult,
  MigrationContext,
  PresetMigrationResult,
} from './types.js';
import { detectOpenClaw } from '../detect.js';
import { migrateOpenClaw, type MigrationSource } from '../migration.js';
import type { SandboxUser, DirectoryStructure as LegacyDirectoryStructure } from '../types.js';

/**
 * OpenClaw preset implementation
 */
export const openclawPreset: TargetPreset = {
  id: 'openclaw',
  name: 'OpenClaw',
  description: 'AI coding agent (auto-detected via npm or git)',

  requiredBins: ['node', 'npm', 'npx', 'git', 'curl', 'shieldctl'],
  optionalBins: ['wget', 'ssh', 'scp', 'python3', 'pip', 'brew'],

  async detect(): Promise<PresetDetectionResult | null> {
    const result = detectOpenClaw();

    if (!result.installation.found) {
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
};
