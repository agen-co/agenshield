/**
 * Constants for AgenShield
 */

import * as os from 'node:os';
import * as path from 'node:path';

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

/**
 * @deprecated Use migrationStatePath() instead.
 * Retained for backward-compat reads of legacy installations.
 */
export const MIGRATION_STATE_PATH = '/etc/agenshield/migrations.json';

/**
 * Resolve the host user's home directory.
 *
 * Priority:
 * 1. Explicit `hostHome` parameter
 * 2. `AGENSHIELD_USER_HOME` env var (set by the LaunchDaemon launcher)
 * 3. `HOME` env var
 * 4. `os.homedir()`
 */
export function resolveUserHome(hostHome?: string): string {
  return hostHome || process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || os.homedir();
}

/** ~/.agenshield config directory */
export function configDirPath(home?: string): string {
  return path.join(resolveUserHome(home), '.agenshield');
}

/** ~/.agenshield/mdm.json */
export function mdmConfigPath(home?: string): string {
  return path.join(configDirPath(home), 'mdm.json');
}

/** ~/.agenshield/logs */
export function logDir(home?: string): string {
  return path.join(configDirPath(home), 'logs');
}

/** ~/.agenshield/run/agenshield.sock */
export function socketPath(home?: string): string {
  return path.join(configDirPath(home), 'run', 'agenshield.sock');
}

/** ~/.agenshield/run */
export function socketDir(home?: string): string {
  return path.join(configDirPath(home), 'run');
}

/** ~/.agenshield/run/privilege-helper.sock */
export function privilegeHelperSocket(home?: string): string {
  return path.join(socketDir(home), 'privilege-helper.sock');
}

/** ~/.agenshield/seatbelt */
export function seatbeltDirPath(home?: string): string {
  return path.join(configDirPath(home), 'seatbelt');
}

/** ~/.agenshield/zdot */
export function zdotDirPath(home?: string): string {
  return path.join(configDirPath(home), 'zdot');
}

/** ~/.agenshield/path-registry.json */
export function pathRegistryPath(home?: string): string {
  return path.join(configDirPath(home), 'path-registry.json');
}

/** Resolve migration state file path under the host user's ~/.agenshield/ */
export function migrationStatePath(hostHome?: string): string {
  return path.join(configDirPath(hostHome), 'migrations.json');
}

/** Default OAuth callback port */
export const CALLBACK_PORT = 9876;

/** MCP Gateway URL */
export const MCP_GATEWAY = 'https://mcp.marketplace.frontegg.com';

/** Marketplace API URL (direct REST calls — different subdomain from MCP gateway) */
export const MARKETPLACE_API = 'https://my.mcp.marketplace.frontegg.com';

// MDM configuration paths
/**
 * @deprecated Use mdmConfigPath() instead.
 * Retained for backward-compat reads of legacy installations.
 */
export const MDM_CONFIG_DIR = '/etc/agenshield';

/** MDM org config filename */
export const MDM_CONFIG_FILE = 'mdm.json';

// LaunchDaemon constants (macOS)
/** LaunchDaemon label for the AgenShield daemon */
export const DAEMON_LAUNCHD_LABEL = 'com.agenshield.daemon';

/** LaunchDaemon plist path */
export const DAEMON_LAUNCHD_PLIST = '/Library/LaunchDaemons/com.agenshield.daemon.plist';

/** LaunchDaemon label for the AgenShield privilege helper */
export const PRIVILEGE_HELPER_LAUNCHD_LABEL = 'com.agenshield.privilege-helper';

/** LaunchDaemon plist path for the privilege helper */
export const PRIVILEGE_HELPER_LAUNCHD_PLIST = '/Library/LaunchDaemons/com.agenshield.privilege-helper.plist';

/**
 * @deprecated Use logDir() instead.
 * Retained for backward-compat reads of legacy installations.
 */
export const SYSTEM_LOG_DIR = '/var/log/agenshield';

// Code signing identifiers (macOS)
/** Reverse-DNS prefix for all AgenShield codesign identifiers */
export const AGENSHIELD_CODESIGN_PREFIX = 'com.frontegg.agenshield';

/** Codesign identifier for the CLI binary */
export const CLI_CODESIGN_ID = `${AGENSHIELD_CODESIGN_PREFIX}.cli`;

/** Codesign identifier for the daemon binary */
export const DAEMON_CODESIGN_ID = `${AGENSHIELD_CODESIGN_PREFIX}.daemon`;

/** Codesign identifier for the broker binary */
export const BROKER_CODESIGN_ID = `${AGENSHIELD_CODESIGN_PREFIX}.broker`;

/** Codesign identifier for the better-sqlite3 native module */
export const NATIVE_SQLITE_CODESIGN_ID = `${AGENSHIELD_CODESIGN_PREFIX}.native.better-sqlite3`;

/** Map of binary base names to their codesign identifiers */
const CODESIGN_ID_MAP: Record<string, string> = {
  'agenshield': CLI_CODESIGN_ID,
  'agenshield-daemon': DAEMON_CODESIGN_ID,
  'agenshield-broker': BROKER_CODESIGN_ID,
  'better_sqlite3.node': NATIVE_SQLITE_CODESIGN_ID,
};

/**
 * Resolve the codesign identifier for a binary given its file path.
 * Returns `undefined` for unknown binaries.
 */
export function resolveCodesignIdentifier(binaryPath: string): string | undefined {
  const basename = path.basename(binaryPath);
  return CODESIGN_ID_MAP[basename];
}

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
