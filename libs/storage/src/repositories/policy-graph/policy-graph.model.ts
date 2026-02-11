/**
 * Policy Graph model — DB row mappers
 */

import type { PolicyNode, PolicyEdge, EdgeActivation, EdgeEffect, EdgeLifetime } from '@agenshield/ipc';
import type { DbPolicyNodeRow, DbPolicyEdgeRow, DbEdgeActivationRow } from '../../types';

// ---- Row mappers ----

export function mapNode(row: DbPolicyNodeRow): PolicyNode {
  return {
    id: row.id,
    policyId: row.policy_id,
    targetId: row.target_id ?? undefined,
    userUsername: row.user_username ?? undefined,
    dormant: row.dormant === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEdge(row: DbPolicyEdgeRow): PolicyEdge {
  return {
    id: row.id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    effect: row.effect as EdgeEffect,
    lifetime: row.lifetime as EdgeLifetime,
    priority: row.priority,
    condition: row.condition ?? undefined,
    secretName: row.secret_name ?? undefined,
    grantPatterns: row.grant_patterns ? JSON.parse(row.grant_patterns) : undefined,
    delayMs: row.delay_ms,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapActivation(row: DbEdgeActivationRow): EdgeActivation {
  return {
    id: row.id,
    edgeId: row.edge_id,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at ?? undefined,
    processId: row.process_id ?? undefined,
    consumed: row.consumed === 1,
  };
}
