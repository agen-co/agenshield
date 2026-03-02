/**
 * Custom error types for the broker
 */

/**
 * Base error class for broker errors
 */
export class BrokerError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'BrokerError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Error thrown when a workspace path is not in the allowed list
 */
export class WorkspaceAccessDeniedError extends BrokerError {
  public readonly path: string;

  constructor(path: string) {
    super(`Workspace path not allowed: ${path}`, 'WORKSPACE_ACCESS_DENIED');
    this.name = 'WorkspaceAccessDeniedError';
    this.path = path;
  }
}
