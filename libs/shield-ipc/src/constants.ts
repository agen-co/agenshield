/**
 * Constants for AgenShield
 */

/** Default HTTP server port */
export const DEFAULT_PORT = 6969;

/** Default HTTP server host */
export const DEFAULT_HOST = 'localhost';

/** Custom hostname for hosts file entry */
export const CUSTOM_HOSTNAME = 'agen.shield';

// Paths relative to user home directory
/** Configuration directory name */
export const CONFIG_DIR = '.agenshield';

/** Configuration file name */
export const CONFIG_FILE = 'config.json';

/** PID file name */
export const PID_FILE = 'daemon.pid';

/** Log file name */
export const LOG_FILE = 'daemon.log';

/** State file name */
export const STATE_FILE = 'state.json';

/** Encrypted vault file name */
export const VAULT_FILE = 'vault.enc';

/** AgenCo subdirectory */
export const AGENCO_DIR = 'agenco';

/** Policies subdirectory */
export const POLICIES_DIR = 'policies';

/** Users subdirectory */
export const USERS_DIR = 'users';

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
