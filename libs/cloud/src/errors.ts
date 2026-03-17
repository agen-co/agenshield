/**
 * Cloud error classes
 *
 * Typed errors for cloud transport, auth, and enrollment operations.
 */

/**
 * Base error for all cloud-related errors
 */
export class CloudError extends Error {
  readonly code: string;

  constructor(message: string, code = 'CLOUD_ERROR') {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Thrown when WebSocket or HTTP connection to cloud fails
 */
export class CloudConnectionError extends CloudError {
  readonly cloudUrl?: string;

  constructor(message = 'Cloud connection failed', cloudUrl?: string) {
    super(message, 'CLOUD_CONNECTION_FAILED');
    this.name = 'CloudConnectionError';
    this.cloudUrl = cloudUrl;
  }
}

/**
 * Thrown when agent-to-cloud authentication fails (invalid AgentSig, expired timestamp, etc.)
 */
export class CloudAuthError extends CloudError {
  readonly agentId?: string;

  constructor(message = 'Cloud authentication failed', agentId?: string) {
    super(message, 'CLOUD_AUTH_FAILED');
    this.name = 'CloudAuthError';
    this.agentId = agentId;
  }
}

/**
 * Thrown when device enrollment fails
 */
export class CloudEnrollmentError extends CloudError {
  readonly retryable: boolean;

  constructor(message = 'Cloud enrollment failed', retryable = true) {
    super(message, 'CLOUD_ENROLLMENT_FAILED');
    this.name = 'CloudEnrollmentError';
    this.retryable = retryable;
  }
}

/**
 * Thrown when a cloud command fails to execute
 */
export class CloudCommandError extends CloudError {
  readonly method?: string;

  constructor(message = 'Cloud command failed', method?: string) {
    super(message, 'CLOUD_COMMAND_FAILED');
    this.name = 'CloudCommandError';
    this.method = method;
  }
}
