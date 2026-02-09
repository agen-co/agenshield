/**
 * API types for AgenShield daemon communication
 */
import type { DaemonStatus } from './daemon';
import type { ShieldConfig } from './config';
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: ApiError;
}
export interface ApiError {
    code: string;
    message: string;
    details?: unknown;
}
/**
 * Security status data
 */
export interface SecurityStatusData {
    /** Is the current process running as root? */
    runningAsRoot: boolean;
    /** Current user */
    currentUser: string;
    /** Is sandbox user created? */
    sandboxUserExists: boolean;
    /** Is OpenClaw isolated to sandbox user? */
    isIsolated: boolean;
    /** Is guarded shell installed? */
    guardedShellInstalled: boolean;
    /** Exposed secrets found in environment (names only) */
    exposedSecrets: string[];
    /** Security warnings */
    warnings: string[];
    /** Critical security issues */
    critical: string[];
    /** Recommendations */
    recommendations: string[];
    /** Overall security level */
    level: 'secure' | 'partial' | 'unprotected' | 'critical';
}
export type GetStatusResponse = ApiResponse<DaemonStatus>;
export type GetConfigResponse = ApiResponse<ShieldConfig>;
export type UpdateConfigResponse = ApiResponse<ShieldConfig>;
export type HealthResponse = ApiResponse<{
    ok: boolean;
    timestamp: string;
    mode?: 'daemon' | 'setup' | 'update';
}>;
export type GetSecurityStatusResponse = ApiResponse<SecurityStatusData>;
export type UpdateConfigRequest = Partial<ShieldConfig>;
//# sourceMappingURL=api.d.ts.map