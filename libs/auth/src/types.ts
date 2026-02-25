/**
 * JWT auth types
 *
 * Core type definitions for the JWT authentication system.
 */

/**
 * Token roles in the system
 */
export type TokenRole = 'admin' | 'broker';

/**
 * Admin JWT payload — issued to Shield-UI and CLI
 */
export interface AdminPayload {
  /** Always 'shield-ui' for admin tokens */
  sub: 'shield-ui';
  /** Role discriminator */
  role: 'admin';
  /** Issued-at (unix seconds) */
  iat: number;
  /** Expiration (unix seconds) */
  exp: number;
}

/**
 * Broker JWT payload — issued per shielded app (target profile)
 */
export interface BrokerPayload {
  /** Profile ID of the target */
  sub: string;
  /** Role discriminator */
  role: 'broker';
  /** Target ID for scoping */
  targetId: string;
  /** Issued-at (unix seconds) */
  iat: number;
  /** No expiration for broker tokens */
}

/**
 * Union of all JWT payload types
 */
export type JwtPayload = AdminPayload | BrokerPayload;

/**
 * Result of verifying a JWT
 */
export interface VerifyResult {
  /** Whether the token is valid */
  valid: boolean;
  /** Decoded payload (only when valid) */
  payload?: JwtPayload;
  /** Error message (only when invalid) */
  error?: string;
}

/**
 * Options for creating the JWT auth hook
 */
export interface JwtAuthHookOptions {
  /** Routes that skip auth entirely */
  publicRoutes?: string[];
  /** Routes that require admin role */
  adminOnlyRoutes?: Array<{ method: string; path: string }>;
}

/**
 * JWT secret manager options
 */
export interface SecretManagerOptions {
  /** Directory where the secret file is stored */
  secretDir?: string;
  /** Filename for the JWT secret */
  secretFilename?: string;
}

/**
 * Sudo verification result
 */
export interface SudoVerifyResult {
  /** Whether the password was valid */
  valid: boolean;
  /** The username that was verified */
  username: string;
}
