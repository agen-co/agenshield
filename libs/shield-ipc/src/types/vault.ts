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
 * Secret scope determines how a secret is injected at runtime.
 * - 'global'    — injected into every exec (policyIds=[])
 * - 'policed'   — injected only when linked policies match
 * - 'standalone' — stored encrypted but never synced/injected
 */
export type SecretScope = 'global' | 'policed' | 'standalone';

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
  /**
   * Secret scope. When absent, inferred from policyIds for backward compat:
   *   policyIds.length === 0 => 'global', else => 'policed'
   */
  scope?: SecretScope;
  /** Profile ID this secret is scoped to (undefined/null = global) */
  profileId?: string | null;
}

/**
 * Aggregated env variable requirement across installed skills.
 * Returned by GET /secrets/skill-env.
 */
export interface SkillEnvRequirement {
  /** Env variable name (e.g. OPENAI_API_KEY) */
  name: string;
  /** True if any skill marks it required */
  required: boolean;
  /** True if any skill marks it sensitive */
  sensitive: boolean;
  /** Human-readable purpose from skill analysis */
  purpose: string;
  /** Skills that require this variable */
  requiredBy: Array<{ skillName: string }>;
  /** Whether a vault secret with this name already exists */
  fulfilled: boolean;
  /** Scope of the existing secret, if fulfilled */
  existingSecretScope?: SecretScope;
  /** ID of the existing secret, if fulfilled */
  existingSecretId?: string;
}

/**
 * A policy binding that carries secrets for sync to the broker.
 * Pushed from daemon to broker via IPC (secrets_sync over Unix socket).
 */
export interface SecretPolicyBinding {
  /** The daemon policy ID */
  policyId: string;
  /** Policy target type (url or command) */
  target: 'url' | 'command';
  /** Policy patterns for matching (glob/URL patterns) */
  patterns: string[];
  /** Secrets to inject when this policy matches: envVarName -> plaintext value */
  secrets: Record<string, string>;
}

/**
 * Payload pushed from daemon to broker via IPC (secrets_sync).
 * Contains decrypted secrets grouped by policy bindings for automatic injection.
 * No longer written to disk — held in broker memory only.
 */
export interface SyncedSecrets {
  /** Schema version */
  version: string;
  /** ISO timestamp of last sync */
  syncedAt: string;
  /** Global secrets (policyIds=[]) injected into every exec: envVarName -> value */
  globalSecrets: Record<string, string>;
  /** Policy-linked secrets, injected only when the policy's patterns match */
  policyBindings: SecretPolicyBinding[];
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
  /** Unique per-installation key for skill trust verification */
  installationKey?: string;
  /** HMAC-SHA256 of config.json policies for tamper detection */
  configHmac?: string;
}
