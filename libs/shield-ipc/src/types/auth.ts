/**
 * Authentication types
 *
 * Types for JWT-based authentication and session management
 */

/**
 * JWT auth status response
 */
export interface AuthStatusResponse {
  /** Whether the request is authenticated */
  authenticated: boolean;
  /** Role of the authenticated user (admin or broker) */
  role?: 'admin' | 'broker';
  /** Token expiration timestamp in ms (admin tokens only) */
  expiresAt?: number;
}

/**
 * Sudo login request — authenticate with macOS credentials
 */
export interface SudoLoginRequest {
  /** macOS username (auto-detected from host if omitted) */
  username?: string;
  /** macOS password */
  password: string;
}

/**
 * Sudo login response
 */
export interface SudoLoginResponse {
  /** Whether authentication succeeded */
  success: boolean;
  /** JWT token (only on success) */
  token?: string;
  /** Token expiration timestamp in ms (only on success) */
  expiresAt?: number;
  /** Error message (only on failure) */
  error?: string;
}

/**
 * Token refresh response
 */
export interface RefreshResponse {
  /** Whether refresh succeeded */
  success: boolean;
  /** New JWT token (only on success) */
  token?: string;
  /** New expiration timestamp in ms (only on success) */
  expiresAt?: number;
  /** Error message (only on failure) */
  error?: string;
}

/**
 * Auth configuration (kept for rate limiting constants)
 */
export interface AuthConfig {
  /** Maximum failed sudo attempts before lockout */
  maxFailedAttempts: number;
  /** Lockout duration in milliseconds */
  lockoutDurationMs: number;
}

/**
 * Default auth configuration
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  maxFailedAttempts: 5,
  lockoutDurationMs: 15 * 60 * 1000, // 15 minutes
};
