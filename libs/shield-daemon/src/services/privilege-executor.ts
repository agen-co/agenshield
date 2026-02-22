/**
 * PrivilegeExecutor interface
 *
 * Abstracts how privileged (root) commands are executed.
 * Implementations include:
 * - OsascriptExecutor: macOS native dialog via privilege helper (no terminal needed)
 */

export interface ExecResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface PrivilegeExecutor {
  /** Execute a command as root */
  execAsRoot(command: string, options?: { timeout?: number }): Promise<ExecResult>;

  /** Execute a command as a specific user */
  execAsUser(user: string, command: string, options?: { timeout?: number }): Promise<ExecResult>;

  /** Check if the executor has active credentials / is available */
  isAvailable(): Promise<boolean>;

  /** Clean up resources (e.g., shut down privilege helper) */
  shutdown(): Promise<void>;
}
