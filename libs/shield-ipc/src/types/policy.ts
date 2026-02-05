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
  target: 'skill' | 'command' | 'url';
  /** Operations this rule applies to */
  operations: OperationType[];
  /** Patterns to match (glob or regex) */
  patterns: string[];
  /** Whether rule is enabled */
  enabled: boolean;
  /** Priority (higher = evaluated first) */
  priority?: number;
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
export const DEFAULT_CHANNEL_RESTRICTIONS: ChannelRestriction[] = [
  { operation: 'http_request', allowedChannels: ['socket', 'http'] },
  { operation: 'file_read', allowedChannels: ['socket', 'http'] },
  { operation: 'file_write', allowedChannels: ['socket'] },
  { operation: 'file_list', allowedChannels: ['socket', 'http'] },
  { operation: 'exec', allowedChannels: ['socket'] },
  { operation: 'open_url', allowedChannels: ['socket', 'http'] },
  { operation: 'secret_inject', allowedChannels: ['socket'] },
  { operation: 'ping', allowedChannels: ['socket', 'http'] },
  { operation: 'policy_check', allowedChannels: ['socket', 'http'] },
];
