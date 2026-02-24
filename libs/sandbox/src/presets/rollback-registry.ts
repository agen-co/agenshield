/**
 * Rollback Registry
 *
 * Static map of step IDs → rollback handler functions.
 * Used by manifest-driven unshield: after daemon restart, no live PipelineState
 * is available, so handlers use only the persisted ManifestEntry.outputs.
 */

import type { ManifestEntry, PrivilegeExecResult } from '@agenshield/ipc';

/** Context provided to rollback handlers */
export interface RollbackContext {
  /** Execute a command as root via privilege executor */
  execAsRoot: (cmd: string, opts?: { timeout?: number }) => Promise<PrivilegeExecResult>;
  /** Log callback */
  onLog: (message: string) => void;
  /** Agent user's home directory */
  agentHome: string;
  /** Agent username (e.g. ash_openclaw_agent) */
  agentUsername: string;
  /** Profile base name (e.g. 'openclaw') */
  profileBaseName: string;
  /** Host user's home directory */
  hostHome: string;
  /** Host username */
  hostUsername: string;
}

/** A rollback handler undoes a single manifest entry */
export type RollbackHandler = (ctx: RollbackContext, entry: ManifestEntry) => Promise<void>;

const registry = new Map<string, RollbackHandler>();

/** Register a rollback handler for a step ID */
export function registerRollback(stepId: string, handler: RollbackHandler): void {
  registry.set(stepId, handler);
}

/** Get the rollback handler for a step ID (or undefined if none registered) */
export function getRollbackHandler(stepId: string): RollbackHandler | undefined {
  return registry.get(stepId);
}

/** Get all registered step IDs (for debugging/logging) */
export function getRegisteredRollbackSteps(): string[] {
  return Array.from(registry.keys());
}
