/**
 * Auth error classes
 *
 * Typed errors for JWT authentication operations.
 */

/**
 * Base error for all auth-related errors
 */
export class AuthError extends Error {
  readonly code: string;

  constructor(message: string, code = 'AUTH_ERROR') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Thrown when a JWT has expired
 */
export class TokenExpiredError extends AuthError {
  constructor(message = 'Token has expired') {
    super(message, 'TOKEN_EXPIRED');
    this.name = 'TokenExpiredError';
  }
}

/**
 * Thrown when a JWT is malformed or has an invalid signature
 */
export class TokenInvalidError extends AuthError {
  constructor(message = 'Token is invalid') {
    super(message, 'TOKEN_INVALID');
    this.name = 'TokenInvalidError';
  }
}

/**
 * Thrown when a valid token lacks the required role/permissions
 */
export class InsufficientPermissionsError extends AuthError {
  readonly requiredRole: string;
  readonly actualRole: string;

  constructor(requiredRole: string, actualRole: string) {
    super(`Insufficient permissions: requires '${requiredRole}', got '${actualRole}'`, 'INSUFFICIENT_PERMISSIONS');
    this.name = 'InsufficientPermissionsError';
    this.requiredRole = requiredRole;
    this.actualRole = actualRole;
  }
}

/**
 * Thrown when sudo password verification fails
 */
export class SudoVerificationError extends AuthError {
  readonly username: string;

  constructor(username: string, message = 'Sudo verification failed') {
    super(message, 'SUDO_VERIFICATION_FAILED');
    this.name = 'SudoVerificationError';
    this.username = username;
  }
}

/**
 * Thrown when too many login attempts have been made
 */
export class RateLimitError extends AuthError {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Too many attempts. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`, 'RATE_LIMITED');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}
