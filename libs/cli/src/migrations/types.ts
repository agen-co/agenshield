/**
 * Migration system types
 *
 * Types for version-specific migrations that run during `agenshield update`.
 * Each migration targets a specific version and contains ordered steps.
 */

/**
 * Result of executing a single migration step
 */
export interface MigrationStepResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * A single migration step within a version migration
 */
export interface MigrationStep {
  /** Unique step ID, e.g. 'add-env-allowlist-config' */
  id: string;
  /** Human-readable name shown in UI */
  name: string;
  /** Description of what this step does */
  description: string;
  /** Whether this step requires sudo privileges */
  requiresSudo?: boolean;
  /** Execute the migration step */
  execute: (ctx: UpdateContext) => Promise<MigrationStepResult>;
}

/**
 * A version migration containing ordered steps
 */
export interface Migration {
  /** Semver target version, e.g. '0.2.0' */
  version: string;
  /** Markdown release notes for this version */
  releaseNotes: string;
  /** Ordered steps to execute for this migration */
  steps: MigrationStep[];
}

/**
 * Persisted migration state at /etc/agenshield/migrations.json
 */
export interface MigrationState {
  /** Current installed version */
  currentVersion: string;
  /** History of applied migrations */
  history: MigrationRecord[];
  /** ISO timestamp of last update */
  lastUpdatedAt?: string;
}

/**
 * Record of a single migration run
 */
export interface MigrationRecord {
  /** Target version of this migration */
  version: string;
  /** ISO timestamp when applied */
  appliedAt: string;
  /** Step IDs that completed successfully */
  completedSteps: string[];
  /** Whether the migration succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Discovered sandbox user info
 */
export interface DiscoveredUser {
  username: string;
  uid?: number;
  home?: string;
}

/**
 * Context passed to migration steps during update execution
 */
export interface UpdateContext {
  /** Version being updated from */
  fromVersion: string;
  /** Version being updated to */
  toVersion: string;
  /** Discovered ash_* sandbox users */
  sandboxUsers: DiscoveredUser[];
  /** Reconstructed paths config */
  pathsConfig?: Record<string, string>;
  /** Reconstructed user config */
  userConfig?: Record<string, unknown>;
  /** Whether this is a dry run */
  dryRun: boolean;
  /** Whether verbose output is enabled */
  verbose: boolean;
  /** Log a message (broadcast to SSE/terminal) */
  log: (message: string) => void;
  /** Shared data between steps */
  stepData: Record<string, unknown>;
}
