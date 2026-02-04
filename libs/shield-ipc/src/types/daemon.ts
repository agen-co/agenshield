/**
 * Daemon status types for AgenShield
 */

export interface DaemonStatus {
  /** Whether the daemon is currently running */
  running: boolean;
  /** Process ID of the daemon */
  pid?: number;
  /** Uptime in seconds */
  uptime?: number;
  /** Version of the daemon */
  version: string;
  /** Port the daemon is listening on */
  port: number;
  /** ISO timestamp when the daemon started */
  startedAt?: string;
}
