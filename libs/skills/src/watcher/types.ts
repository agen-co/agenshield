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
  /** Skills directory to scan for new/unknown skills (filesystem scan) */
  skillsDir?: string;
  /** Directory to move unregistered skills for quarantine + analysis */
  quarantineDir?: string;
  /** Debounce interval for fs.watch events in ms (default: 500) */
  fsScanDebounceMs?: number;
}

/** Callback for when a new skill is detected during filesystem scan */
export interface SkillScanCallbacks {
  /** Called when a skill is auto-approved (has valid installation tag) */
  onAutoApproved?: (slug: string) => void;
  /** Called when a skill is quarantined (no valid installation tag) */
  onQuarantined?: (slug: string, reason: string) => void;
}

/** Fully resolved policy with no optional fields */
export interface ResolvedWatcherPolicy {
  onModified: WatcherAction;
  onDeleted: WatcherAction;
}
