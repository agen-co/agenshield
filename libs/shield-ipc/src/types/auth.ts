/**
 * Authentication types
 *
 * Types for passcode authentication and session management
 */

/**
 * Auth status response - check if passcode is set and protection enabled
 */
export interface AuthStatusResponse {
  /** Whether a passcode has been set */
  passcodeSet: boolean;
  /** Whether passcode protection is enabled */
  protectionEnabled: boolean;
  /** Whether anonymous read-only access is allowed (default: true) */
  allowAnonymousReadOnly: boolean;
  /** Whether the account is currently locked out due to failed attempts */
  lockedOut: boolean;
  /** ISO timestamp when lockout expires (if locked) */
  lockedUntil?: string;
}

/**
 * Unlock request - authenticate with passcode
 */
export interface UnlockRequest {
  /** The passcode to verify */
  passcode: string;
}

/**
 * Unlock response - returns session token on success
 */
export interface UnlockResponse {
  /** Whether authentication succeeded */
  success: boolean;
  /** Session token (only on success) */
  token?: string;
  /** Token expiration timestamp in ms (only on success) */
  expiresAt?: number;
  /** Error message (only on failure) */
  error?: string;
  /** Remaining attempts before lockout (only on failure) */
  remainingAttempts?: number;
}

/**
 * Lock request - invalidate session
 */
export interface LockRequest {
  /** Session token to invalidate */
  token: string;
}

/**
 * Lock response
 */
export interface LockResponse {
  /** Whether the session was invalidated */
  success: boolean;
}

/**
 * Setup request - set initial passcode
 */
export interface SetupPasscodeRequest {
  /** The passcode to set */
  passcode: string;
  /** Whether to enable protection immediately */
  enableProtection?: boolean;
}

/**
 * Setup response
 */
export interface SetupPasscodeResponse {
  /** Whether setup succeeded */
  success: boolean;
  /** Error message (only on failure) */
  error?: string;
}

/**
 * Change passcode request
 */
export interface ChangePasscodeRequest {
  /** Current passcode (required unless running as root) */
  oldPasscode?: string;
  /** New passcode to set */
  newPasscode: string;
}

/**
 * Change passcode response
 */
export interface ChangePasscodeResponse {
  /** Whether change succeeded */
  success: boolean;
  /** Error message (only on failure) */
  error?: string;
}

/**
 * Session info (internal use)
 */
export interface Session {
  /** Session token */
  token: string;
  /** When session was created */
  createdAt: number;
  /** When session expires */
  expiresAt: number;
  /** Client identifier (optional) */
  clientId?: string;
}

/**
 * Auth configuration
 */
export interface AuthConfig {
  /** Session TTL in milliseconds (default: 30 minutes) */
  sessionTtlMs: number;
  /** Maximum failed attempts before lockout */
  maxFailedAttempts: number;
  /** Lockout duration in milliseconds */
  lockoutDurationMs: number;
  /** Idle timeout in milliseconds before auto-locking the vault (default: 5 minutes) */
  autoLockTimeoutMs: number;
}

/**
 * Default auth configuration
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  sessionTtlMs: 30 * 60 * 1000, // 30 minutes
  maxFailedAttempts: 5,
  lockoutDurationMs: 15 * 60 * 1000, // 15 minutes
  autoLockTimeoutMs: 5 * 60 * 1000, // 5 minutes
};
