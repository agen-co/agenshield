/**
 * Vault types
 *
 * Types for encrypted vault storage (vault.enc)
 */

/**
 * AgentLink OAuth secrets
 */
export interface AgentLinkSecrets {
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
 * Vault contents structure
 */
export interface VaultContents {
  /** AgentLink OAuth tokens and secrets */
  agentlink?: AgentLinkSecrets;
  /** Environment variables for sandboxed processes */
  envSecrets: Record<string, string>;
  /** Sensitive patterns for policy matching */
  sensitivePatterns: string[];
  /** Passcode for authentication */
  passcode?: PasscodeData;
}
