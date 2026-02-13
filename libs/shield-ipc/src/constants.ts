/**
 * Constants for AgenShield
 */

/** Default HTTP server port */
export const DEFAULT_PORT = 5200;

/** Default HTTP server host - use IPv4 explicitly to avoid IPv6 binding issues */
export const DEFAULT_HOST = '127.0.0.1';

/** Custom hostname for hosts file entry */
export const CUSTOM_HOSTNAME = 'agen.shield';

// Paths relative to user home directory
/** Configuration directory name */
export const CONFIG_DIR = '.agenshield';

/**
 * @deprecated Config is now stored in SQLite (agenshield.db).
 * Retained for migration cleanup of legacy installations.
 */
export const CONFIG_FILE = 'config.json';

/** PID file name */
export const PID_FILE = 'daemon.pid';

/** Log file name */
export const LOG_FILE = 'daemon.log';

/**
 * @deprecated State is now stored in SQLite (agenshield.db).
 * Retained for migration cleanup of legacy installations.
 */
export const STATE_FILE = 'state.json';

/** Encrypted vault file name */
export const VAULT_FILE = 'vault.enc';

/**
 * @deprecated Secrets are now pushed to the broker via IPC (secrets_sync).
 * This constant is retained for migration cleanup of legacy installations.
 */
export const SYNCED_SECRETS_FILE = 'synced-secrets.json';

/** AgenCo subdirectory */
export const AGENCO_DIR = 'agenco';

/** Policies subdirectory */
export const POLICIES_DIR = 'policies';

/** Users subdirectory */
export const USERS_DIR = 'users';

/** Marketplace downloads subdirectory (under CONFIG_DIR) */
export const MARKETPLACE_DIR = 'marketplace';

/** Skill backup subdirectory (under CONFIG_DIR) */
export const SKILL_BACKUP_DIR = 'skills/backup';

/** Path to migration state file (root-owned) */
export const MIGRATION_STATE_PATH = '/etc/agenshield/migrations.json';

/** Default OAuth callback port */
export const CALLBACK_PORT = 9876;

/** MCP Gateway URL */
export const MCP_GATEWAY = 'https://mcp.marketplace.frontegg.com';

/** Marketplace API URL (direct REST calls — different subdomain from MCP gateway) */
export const MARKETPLACE_API = 'https://my.mcp.marketplace.frontegg.com';

// API Endpoints
/** API route prefix */
export const API_PREFIX = '/api';

/** API endpoint paths */
export const ENDPOINTS = {
  HEALTH: '/health',
  STATUS: '/status',
  CONFIG: '/config',
  POLICIES: '/policies',
  SECURITY: '/security',
} as const;

// SSE Endpoints
/** SSE route prefix */
export const SSE_PREFIX = '/sse';

/** SSE endpoint paths */
export const SSE_ENDPOINTS = {
  /** All events stream */
  EVENTS: '/sse/events',
  /** Security events only */
  SECURITY: '/sse/events/security',
  /** Broker events only */
  BROKER: '/sse/events/broker',
  /** API traffic events only */
  API: '/sse/events/api',
} as const;
