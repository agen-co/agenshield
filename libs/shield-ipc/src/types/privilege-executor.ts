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

/** Callback invoked with real-time output chunks from a running command. */
export type OutputCallback = (stream: 'stdout' | 'stderr', data: string) => void;

/** Options for privileged command execution. */
export interface PrivilegeExecOptions {
  timeout?: number;
  /** When provided, receives real-time output chunks streamed from the privilege helper. */
  onOutput?: OutputCallback;
}

export interface PrivilegeExecutor {
  /** Execute a command as root */
  execAsRoot(command: string, options?: PrivilegeExecOptions): Promise<PrivilegeExecResult>;

  /** Execute a command as a specific user */
  execAsUser(user: string, command: string, options?: PrivilegeExecOptions): Promise<PrivilegeExecResult>;

  /** Execute a command as a specific user with plain /bin/bash (no guarded shell) */
  execAsUserDirect(user: string, command: string, options?: PrivilegeExecOptions): Promise<PrivilegeExecResult>;

  /** Check if the executor has active credentials / is available */
  isAvailable(): Promise<boolean>;

  /** Clean up resources (e.g., shut down privilege helper) */
  shutdown(): Promise<void>;
}
