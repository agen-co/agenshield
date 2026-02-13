/**
 * Response redaction for unauthenticated API consumers.
 *
 * Strips sensitive fields from config and security responses
 * while keeping enough info for the read-only dashboard view.
 */

import type { ShieldConfig, PolicyConfig } from '@agenshield/ipc';

/**
 * Redact a config object for anonymous API consumers.
 * Strips policy patterns, operations, scope, and networkAccess.
 */
export function redactConfig(config: ShieldConfig): ShieldConfig {
  return {
    ...config,
    policies: config.policies.map(redactPolicy),
  };
}

function redactPolicy(policy: PolicyConfig): PolicyConfig {
  return {
    id: policy.id,
    name: policy.name,
    action: policy.action,
    target: policy.target,
    patterns: [],
    enabled: policy.enabled,
    ...(policy.preset !== undefined && { preset: policy.preset }),
    ...(policy.priority !== undefined && { priority: policy.priority }),
  };
}

/**
 * Redact a security status response for anonymous API consumers.
 * Empties exposedSecrets and recommendations arrays.
 */
export function redactSecurityStatus<T extends { exposedSecrets?: string[]; recommendations?: string[] }>(
  status: T,
): T {
  return {
    ...status,
    exposedSecrets: [],
    recommendations: [],
  };
}
