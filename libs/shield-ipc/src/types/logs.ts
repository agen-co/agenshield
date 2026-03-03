/**
 * Log download types — sanitized log bundles for diagnostics and support.
 */

/** A single shield operation log file entry */
export interface ShieldLogEntry {
  /** Original filename (e.g., shield-2026-03-01T12-00-00.log) */
  filename: string;
  /** Sanitized log content */
  content: string;
}

/** A single daemon log entry */
export interface DaemonLogEntry {
  /** Unix timestamp */
  timestamp: number;
  /** Log level name */
  level: string;
  /** Log message */
  msg: string;
}

/** System info included in the log bundle */
export interface LogBundleSystemInfo {
  /** OS platform and version (e.g., "darwin 24.6.0") */
  os: string;
  /** Daemon version */
  daemonVersion: string;
}

/** The full sanitized log bundle for download */
export interface LogBundle {
  /** Bundle format version */
  version: '1.0';
  /** ISO timestamp when the bundle was generated */
  generatedAt: string;
  /** Basic system info (no usernames) */
  system: LogBundleSystemInfo;
  /** Shield operation logs grouped by target ID */
  shieldLogs: Record<string, ShieldLogEntry[]>;
  /** Recent daemon log entries */
  daemonLogs: DaemonLogEntry[];
}

/** Query parameters for the log download endpoint */
export interface LogDownloadParams {
  /** Filter by target ID (e.g., "claude-code") */
  target?: string;
  /** Max log files per target (default: 5) */
  maxFiles?: number;
}
