/**
 * Playground simulation types
 *
 * Used by the POST /playground/simulate endpoint to test
 * policy configuration against real command execution.
 */

export interface SimulateRequest {
  /** Full command string to simulate */
  command: string;
  /** Timeout in ms (default: 30000, max: 60000) */
  timeout?: number;
}

export interface SimulatedOperation {
  /** Unique identifier */
  id: string;
  /** Sequential order */
  seq: number;
  /** Operation type */
  type: 'exec' | 'http_request' | 'file_write' | 'file_read';
  /** URL, path, or command */
  target: string;
  /** Policy decision */
  action: 'allow' | 'deny';
  /** Matched policy ID */
  policyId?: string;
  /** Matched policy name */
  policyName?: string;
  /** Reason for decision */
  reason?: string;
  /** ISO timestamp */
  timestamp: string;
  /** Additional details (HTTP method, status, etc.) */
  detail?: Record<string, unknown>;
}

export interface SimulateResponse {
  simulationId: string;
  command: string;
  status: 'completed' | 'timeout' | 'error';
  operations: SimulatedOperation[];
  exitCode: number | null;
  /** Truncated to 4KB */
  stdout: string;
  /** Truncated to 4KB */
  stderr: string;
  durationMs: number;
  summary: {
    total: number;
    allowed: number;
    denied: number;
    byType: Record<string, { total: number; allowed: number; denied: number }>;
  };
}
