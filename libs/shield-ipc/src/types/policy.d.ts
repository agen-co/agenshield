/**
 * Policy types for AgenShield
 */
import type { OperationType } from './ops';
/**
 * Policy rule definition
 */
export interface PolicyRule {
    /** Unique identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Policy action: allow, deny, or approval (future) */
    action: 'allow' | 'deny' | 'approval';
    /** What this rule targets */
    target: 'skill' | 'command' | 'url' | 'filesystem';
    /** Operations this rule applies to */
    operations: OperationType[];
    /** Patterns to match (glob or regex) */
    patterns: string[];
    /** Whether rule is enabled */
    enabled: boolean;
    /** Priority (higher = evaluated first) */
    priority?: number;
    /** Scope restriction: 'agent', 'skill', or 'skill:<slug>' */
    scope?: 'agent' | 'skill' | string;
}
/**
 * File system constraints
 */
export interface FsConstraints {
    /** Paths that are allowed for file operations */
    allowedPaths: string[];
    /** Patterns that are denied (e.g., .env, secrets.json) */
    deniedPatterns: string[];
}
/**
 * Network constraints
 */
export interface NetworkConstraints {
    /** Hosts that are allowed */
    allowedHosts: string[];
    /** Hosts that are denied */
    deniedHosts: string[];
    /** Ports that are allowed */
    allowedPorts: number[];
}
/**
 * Environment variable injection rule
 */
export interface EnvInjectionRule {
    /** Name of the secret in vault */
    secretName: string;
    /** Target environment variable name */
    targetEnv: string;
    /** Operations that can access this secret */
    operations: OperationType[];
}
/**
 * Complete policy configuration
 */
export interface PolicyConfiguration {
    /** Schema version */
    version: string;
    /** Policy rules */
    rules: PolicyRule[];
    /** Default action when no rules match */
    defaultAction: 'allow' | 'deny';
    /** File system constraints */
    fsConstraints?: FsConstraints;
    /** Network constraints */
    networkConstraints?: NetworkConstraints;
    /** Environment injection rules */
    envInjection?: EnvInjectionRule[];
}
/**
 * Sandbox configuration for seatbelt wrapping
 */
export interface SandboxConfig {
    /** Whether seatbelt wrapping is enabled */
    enabled: boolean;
    /** Paths allowed for read access */
    allowedReadPaths: string[];
    /** Paths allowed for read+write access */
    allowedWritePaths: string[];
    /** Paths explicitly denied */
    deniedPaths: string[];
    /** Whether network access is allowed */
    networkAllowed: boolean;
    /** Specific hosts allowed for network access */
    allowedHosts: string[];
    /** Specific ports allowed for network access */
    allowedPorts: number[];
    /** Binaries allowed to execute */
    allowedBinaries: string[];
    /** Binaries explicitly denied */
    deniedBinaries: string[];
    /** Environment variables to inject */
    envInjection: Record<string, string>;
    /** Environment variable names to strip */
    envDeny: string[];
    /** Per-policy env var names/patterns to allow (extends base allowlist) */
    envAllow?: string[];
    /** Broker HTTP fallback port for localhost seatbelt rules (default: 5201) */
    brokerHttpPort?: number;
    /** Pre-generated SBPL profile content (overrides dynamic generation) */
    profileContent?: string;
}
/**
 * Execution context for hierarchical permission checking
 */
export interface PolicyExecutionContext {
    /** Whether the caller is an agent or a skill */
    callerType: 'agent' | 'skill';
    /** Slug of the skill (if callerType is 'skill') */
    skillSlug?: string;
    /** Agent identifier */
    agentId?: string;
    /** Call depth in the execution chain */
    depth: number;
    /** Source layer: interceptor (Node.js) or es-extension (macOS EndpointSecurity) */
    sourceLayer?: 'interceptor' | 'es-extension';
    /** Agent user name from ES extension (e.g. "ash_default_agent") */
    esUser?: string;
    /** Process ID from ES extension */
    esPid?: number;
    /** Parent process ID from ES extension */
    esPpid?: number;
    /** macOS audit session ID — groups all execs in a login session */
    esSessionId?: number;
}
/**
 * Policy evaluation result
 */
export interface PolicyEvaluationResult {
    /** Whether the operation is allowed */
    allowed: boolean;
    /** ID of the matching policy rule */
    policyId?: string;
    /** Reason for the decision */
    reason?: string;
    /** Evaluation duration in ms */
    durationMs?: number;
    /** Sandbox configuration for approved exec operations */
    sandbox?: SandboxConfig;
    /** Execution context used during evaluation */
    executionContext?: PolicyExecutionContext;
}
/**
 * Channel restrictions for operations
 */
export interface ChannelRestriction {
    /** Operation type */
    operation: OperationType;
    /** Allowed channels */
    allowedChannels: ('socket' | 'http')[];
}
/**
 * Default channel restrictions
 */
export declare const DEFAULT_CHANNEL_RESTRICTIONS: ChannelRestriction[];
//# sourceMappingURL=policy.d.ts.map