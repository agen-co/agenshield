/**
 * Vault types
 *
 * Types for encrypted vault storage (vault.enc)
 */

/**
 * AgenCo OAuth secrets
 */
export interface AgenCoSecrets {
  /** OAuth access token */
  accessToken: string;
  /** OAuth refresh token */
  refreshToken: string;
  /** Token expiration timestamp (ms) */
  expiresAt: number;
  /** OAuth client ID (from DCR) */
  clientId: string;
  /** OAuth client secret (from DCR) */
  clientSecret: string;
}

/**
 * Passcode data for authentication
 */
export interface PasscodeData {
  /** bcrypt hash of the passcode */
  hash: string;
  /** ISO timestamp when passcode was initially set */
  setAt: string;
  /** ISO timestamp when passcode was last changed */
  changedAt?: string;
}

/**
 * A secret stored in the vault with policy links
 */
export interface VaultSecret {
  /** Unique identifier */
  id: string;
  /** Human-readable name (e.g. DATABASE_URL) */
  name: string;
  /** Secret value (plaintext — vault is AES-256-GCM encrypted) */
  value: string;
  /** Policy IDs this secret is linked to (many-to-many) */
  policyIds: string[];
  /** ISO timestamp when created */
  createdAt: string;
}

/**
 * Vault contents structure
 */
export interface VaultContents {
  /** AgenCo OAuth tokens and secrets */
  agenco?: AgenCoSecrets;
  /** Environment variables for sandboxed processes */
  envSecrets: Record<string, string>;
  /** Sensitive patterns for policy matching */
  sensitivePatterns: string[];
  /** Passcode for authentication */
  passcode?: PasscodeData;
  /** Named secrets with policy links */
  secrets?: VaultSecret[];
}
