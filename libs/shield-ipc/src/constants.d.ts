/**
 * Constants for AgenShield
 */
/** Default HTTP server port */
export declare const DEFAULT_PORT = 6969;
/** Default HTTP server host */
export declare const DEFAULT_HOST = "localhost";
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