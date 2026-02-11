/**
 * Constants for AgenShield
 */
/** Default HTTP server port */
export declare const DEFAULT_PORT = 5200;
/** Default HTTP server host - use IPv4 explicitly to avoid IPv6 binding issues */
export declare const DEFAULT_HOST = "127.0.0.1";
/** Custom hostname for hosts file entry */
export declare const CUSTOM_HOSTNAME = "agen.shield";
/** Configuration directory name */
export declare const CONFIG_DIR = ".agenshield";
/** Configuration file name */
export declare const CONFIG_FILE = "config.json";
/** PID file name */
export declare const PID_FILE = "daemon.pid";
/** Log file name */
export declare const LOG_FILE = "daemon.log";
/** State file name */
export declare const STATE_FILE = "state.json";
/** Encrypted vault file name */
export declare const VAULT_FILE = "vault.enc";
/** Synced secrets file name (daemon -> broker) */
export declare const SYNCED_SECRETS_FILE = "synced-secrets.json";
/** AgenCo subdirectory */
export declare const AGENCO_DIR = "agenco";
/** Policies subdirectory */
export declare const POLICIES_DIR = "policies";
/** Users subdirectory */
export declare const USERS_DIR = "users";
/** Marketplace downloads subdirectory (under CONFIG_DIR) */
export declare const MARKETPLACE_DIR = "marketplace";
/** Path to migration state file (root-owned) */
export declare const MIGRATION_STATE_PATH = "/etc/agenshield/migrations.json";
/** Default OAuth callback port */
export declare const CALLBACK_PORT = 9876;
/** MCP Gateway URL */
export declare const MCP_GATEWAY = "https://mcp.marketplace.frontegg.com";
/** Marketplace API URL (direct REST calls — different subdomain from MCP gateway) */
export declare const MARKETPLACE_API = "https://my.mcp.marketplace.frontegg.com";
/** API route prefix */
export declare const API_PREFIX = "/api";
/** API endpoint paths */
export declare const ENDPOINTS: {
    readonly HEALTH: "/health";
    readonly STATUS: "/status";
    readonly CONFIG: "/config";
    readonly POLICIES: "/policies";
    readonly SECURITY: "/security";
};
/** SSE route prefix */
export declare const SSE_PREFIX = "/sse";
/** SSE endpoint paths */
export declare const SSE_ENDPOINTS: {
    /** All events stream */
    readonly EVENTS: "/sse/events";
    /** Security events only */
    readonly SECURITY: "/sse/events/security";
    /** Broker events only */
    readonly BROKER: "/sse/events/broker";
    /** API traffic events only */
    readonly API: "/sse/events/api";
};
//# sourceMappingURL=constants.d.ts.map