/**
 * Watcher types — polling-based integrity monitor for deployed skills
 */

/** Action to take when tampering is detected */
export type WatcherAction = 'reinstall' | 'quarantine';

/** Policy for how the watcher responds to file changes */
export interface WatcherPolicy {
  onModified: WatcherAction;
  onDeleted: WatcherAction;
}

/** Options for configuring the watcher service */
export interface WatcherOptions {
  /** Polling interval in milliseconds (default: 30000) */
  pollIntervalMs?: number;
  /** Default policy for all installations */
  defaultPolicy?: Partial<WatcherPolicy>;
  /** Per-installation policy overrides keyed by installation ID */
  installationPolicies?: Record<string, Partial<WatcherPolicy>>;
}

/** Fully resolved policy with no optional fields */
export interface ResolvedWatcherPolicy {
  onModified: WatcherAction;
  onDeleted: WatcherAction;
}
