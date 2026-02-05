/**
 * Preset System Types
 *
 * A preset defines how to detect, migrate, and run a specific target application.
 * The sandboxing (users, groups, seatbelt, wrappers) is universal for all targets.
 */

import type { UserDefinition } from '@agenshield/ipc';

/**
 * Result of detecting a target application
 */
export interface PresetDetectionResult {
  /** Whether the target was found */
  found: boolean;
  /** Installed version (if detected) */
  version?: string;
  /** Path to the main package/source directory */
  packagePath?: string;
  /** Path to the binary/entry point */
  binaryPath?: string;
  /** Path to the config directory */
  configPath?: string;
  /** How the target was installed */
  method?: 'npm' | 'git' | 'binary' | 'custom';
}

/**
 * Directory structure for migration
 */
export interface MigrationDirectories {
  /** Local binaries directory */
  binDir: string;
  /** Wrapper scripts directory */
  wrappersDir: string;
  /** Config directory */
  configDir: string;
  /** Package/source directory */
  packageDir: string;
  /** npm packages directory */
  npmDir: string;
}

/**
 * Context provided to preset migration
 */
export interface MigrationContext {
  /** Agent user definition */
  agentUser: UserDefinition;
  /** Directory structure for the sandbox */
  directories: MigrationDirectories;
  /** Entry point path (for custom preset) */
  entryPoint?: string;
  /** Detection result from the detect phase */
  detection?: PresetDetectionResult;
}

/**
 * Result of migrating a target to the sandbox
 */
export interface PresetMigrationResult {
  /** Whether migration succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** New paths after migration */
  newPaths?: {
    packagePath: string;
    binaryPath: string;
    configPath?: string;
  };
}

/**
 * A preset defines how to detect, migrate, and run a specific target application.
 * The sandboxing (users, groups, seatbelt, wrappers) is universal.
 */
export interface TargetPreset {
  /** Unique preset identifier */
  id: string;

  /** Display name */
  name: string;

  /** Description shown in wizard */
  description: string;

  /**
   * Commands this preset requires in the sandbox.
   * These will be installed as protected wrappers in $HOME/bin.
   * Names must match keys in WRAPPER_DEFINITIONS (e.g. 'node', 'npm', 'git', 'curl').
   */
  requiredBins: string[];

  /**
   * Optional commands the preset can use if available.
   * Installed only when the user opts in or when the full wrapper set is requested.
   */
  optionalBins?: string[];

  /**
   * Detect if this target is installed on the system.
   * Returns detection info or null if not found.
   */
  detect(): Promise<PresetDetectionResult | null>;

  /**
   * Migrate the target to the sandbox user.
   * Copies files, sets permissions, creates entry wrapper.
   */
  migrate(context: MigrationContext): Promise<PresetMigrationResult>;

  /**
   * Get the command to run the target in the sandbox.
   * This is what the wrapper scripts will invoke.
   */
  getEntryCommand(context: MigrationContext): string;
}
