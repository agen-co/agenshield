/**
 * Update engine types
 *
 * Types for the update orchestration engine that manages
 * the `agenshield update` lifecycle.
 */

import type { MigrationState, DiscoveredUser } from '../migrations/types.js';

/**
 * Status of an individual update step
 */
export type UpdateStepStatus = 'pending' | 'running' | 'completed' | 'error' | 'skipped';

/**
 * A single step in the update process (built-in or migration)
 */
export interface UpdateStep {
  /** Unique step ID */
  id: string;
  /** Human-readable name shown in UI */
  name: string;
  /** Step description */
  description: string;
  /** Current status */
  status: UpdateStepStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Whether this is a migration step (vs built-in) */
  isMigration?: boolean;
  /** Migration version this step belongs to (if migration step) */
  migrationVersion?: string;
}

/**
 * Overall update state
 */
export interface UpdateState {
  /** From version */
  fromVersion: string;
  /** To version */
  toVersion: string;
  /** All steps to execute */
  steps: UpdateStep[];
  /** Whether update is complete */
  isComplete: boolean;
  /** Whether an error occurred */
  hasError: boolean;
  /** Aggregated release notes markdown */
  releaseNotes: string;
  /** Whether passcode auth is required */
  authRequired: boolean;
  /** Whether passcode has been verified */
  authenticated: boolean;
}

/**
 * Options for creating the update engine
 */
export interface UpdateEngineOptions {
  /** Whether to run in dry-run mode */
  dryRun?: boolean;
  /** Whether to show verbose output */
  verbose?: boolean;
  /** Force update even if already at latest version */
  force?: boolean;
}

/**
 * Preflight check result
 */
export interface PreflightResult {
  /** Whether an update is needed */
  updateNeeded: boolean;
  /** Current installed version */
  currentVersion: string;
  /** Target CLI version */
  targetVersion: string;
  /** Discovered sandbox users */
  sandboxUsers: DiscoveredUser[];
  /** Loaded migration state (or null if fresh) */
  migrationState: MigrationState | null;
  /** Number of pending migrations */
  pendingMigrationCount: number;
  /** Aggregated release notes */
  releaseNotes: string;
  /** Whether a passcode is set */
  passcodeSet: boolean;
  /** Error message if preflight failed */
  error?: string;
}
