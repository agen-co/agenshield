/**
 * Configuration types for AgenShield
 */
export interface ShieldConfig {
    version: string;
    daemon: DaemonConfig;
    policies: PolicyConfig[];
    vault?: VaultConfig;
}
export interface DaemonConfig {
    /** HTTP server port (default: 6969) */
    port: number;
    /** HTTP server host (default: 'localhost') */
    host: string;
    /** Logging level */
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    /** Whether to add agen.shield to /etc/hosts */
    enableHostsEntry: boolean;
}
export interface PolicyConfig {
    /** Unique identifier for the policy */
    id: string;
    /** Human-readable name */
    name: string;
    /** Policy type */
    type: 'allowlist' | 'denylist';
    /** URL/command patterns to match */
    patterns: string[];
    /** Whether this policy is active */
    enabled: boolean;
}
export interface VaultConfig {
    /** Whether vault is enabled */
    enabled: boolean;
    /** Secret provider type */
    provider: 'local' | 'env';
}
//# sourceMappingURL=config.d.ts.map