/**
 * PrivilegeExecutor interfaces
 *
 * Shared type definitions for privileged command execution.
 * Used by both daemon implementation and sandbox install contexts.
 */

export interface PrivilegeExecResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface PrivilegeExecutor {
  /** Execute a command as root */
  execAsRoot(command: string, options?: { timeout?: number }): Promise<PrivilegeExecResult>;

  /** Execute a command as a specific user */
  execAsUser(user: string, command: string, options?: { timeout?: number }): Promise<PrivilegeExecResult>;

  /** Check if the executor has active credentials / is available */
  isAvailable(): Promise<boolean>;

  /** Clean up resources (e.g., shut down privilege helper) */
  shutdown(): Promise<void>;
}
