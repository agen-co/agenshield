/**
 * Preset System Types
 *
 * A preset defines how to detect, migrate, and run a specific target application.
 * The sandboxing (users, groups, seatbelt, wrappers) is universal for all targets.
 */

import type { UserDefinition, MigrationScanResult, MigrationSelection, PrivilegeExecResult } from '@agenshield/ipc';

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
  /** Package/source directory (legacy, no longer created by default) */
  packageDir?: string;
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
  /** User's selection of items to migrate (from scan step) */
  selection?: MigrationSelection;
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
 * Context provided to preset install() method
 */
export interface InstallContext {
  /** Agent user home directory */
  agentHome: string;
  /** Agent username (e.g., ash_openclaw_agent) */
  agentUsername: string;
  /** Socket group name */
  socketGroupName: string;
  /** Workspace group name */
  workspaceGroupName: string;
  /** Detection result from detect phase */
  detection?: PresetDetectionResult;
  /** Host user who originally ran the target */
  hostUsername: string;
  /** Requested version to install (e.g., '2026.2.6' or 'latest') */
  requestedVersion?: string;
  /** Run a command as root via privilege executor */
  execAsRoot: (cmd: string, opts?: { timeout?: number }) => Promise<PrivilegeExecResult>;
  /** Run a command as the agent user via privilege executor */
  execAsUser: (cmd: string, opts?: { timeout?: number }) => Promise<PrivilegeExecResult>;
  /** Progress callback */
  onProgress: (step: string, progress: number, message: string) => void;
  /** Log callback */
  onLog: (message: string) => void;
}

/**
 * Result of installing the target app's runtime environment
 */
export interface InstallResult {
  success: boolean;
  failedStep?: string;
  error?: string;
  appBinaryPath?: string;
  version?: string;
  /** Path to a gateway plist written but NOT loaded (deferred start). */
  gatewayPlistPath?: string;
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
   * Scan the source application for migratable items (skills, env vars).
   * Called AFTER the AgenShield environment is initialized but BEFORE migration.
   * Returns discovered items for user selection.
   * Optional — presets that don't support scanning return null.
   */
  scan?(detection: PresetDetectionResult): Promise<MigrationScanResult | null>;

  /**
   * Migrate the target to the sandbox user.
   * Copies files, sets permissions, creates entry wrapper.
   * When context.selection is provided, only selected items are migrated.
   */
  migrate(context: MigrationContext): Promise<PresetMigrationResult>;

  /**
   * Get the command to run the target in the sandbox.
   * This is what the wrapper scripts will invoke.
   */
  getEntryCommand(context: MigrationContext): string;

  /** Policy preset IDs to seed when this target is shielded */
  policyPresetIds?: string[];

  /**
   * Install the target app's full runtime environment in the agent user.
   * Called after sandbox infrastructure is created (users, dirs, wrappers).
   * Optional — presets that don't define install() skip this step.
   */
  install?(context: InstallContext): Promise<InstallResult>;
}
