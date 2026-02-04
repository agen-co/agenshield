/**
 * Custom error types for the interceptor
 */

/**
 * Base error class for AgenShield errors
 */
export class AgenShieldError extends Error {
  public readonly code: string;
  public readonly operation?: string;
  public readonly target?: string;

  constructor(
    message: string,
    code: string,
    options?: { operation?: string; target?: string }
  ) {
    super(message);
    this.name = 'AgenShieldError';
    this.code = code;
    this.operation = options?.operation;
    this.target = options?.target;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Error thrown when a policy denies an operation
 */
export class PolicyDeniedError extends AgenShieldError {
  public readonly policyId?: string;

  constructor(
    message: string,
    options?: { operation?: string; target?: string; policyId?: string }
  ) {
    super(message, 'POLICY_DENIED', options);
    this.name = 'PolicyDeniedError';
    this.policyId = options?.policyId;
  }
}

/**
 * Error thrown when broker is unavailable
 */
export class BrokerUnavailableError extends AgenShieldError {
  constructor(message: string = 'AgenShield broker is unavailable') {
    super(message, 'BROKER_UNAVAILABLE');
    this.name = 'BrokerUnavailableError';
  }
}

/**
 * Error thrown when request times out
 */
export class TimeoutError extends AgenShieldError {
  constructor(message: string = 'Request timed out') {
    super(message, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown for invalid operations
 */
export class InvalidOperationError extends AgenShieldError {
  constructor(message: string, operation?: string) {
    super(message, 'INVALID_OPERATION', { operation });
    this.name = 'InvalidOperationError';
  }
}
