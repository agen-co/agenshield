/**
 * Policy Graph SQL queries
 */

const NODES = 'policy_nodes';
const EDGES = 'policy_edges';
const ACTIVATIONS = 'edge_activations';

export const Q = {
  // ---- Nodes ----
  insertNode: `
    INSERT INTO ${NODES} (id, policy_id, profile_id, dormant, metadata, created_at, updated_at)
    VALUES (@id, @policyId, @profileId, @dormant, @metadata, @createdAt, @updatedAt)`,

  selectNodeById: `SELECT * FROM ${NODES} WHERE id = ?`,
  selectNodeByPolicyId: `SELECT * FROM ${NODES} WHERE policy_id = ?`,
  deleteNode: `DELETE FROM ${NODES} WHERE id = ?`,

  selectNodesByScope: (scopeClause: string) =>
    `SELECT * FROM ${NODES} WHERE ${scopeClause}`,

  // ---- Edges ----
  insertEdge: `
    INSERT INTO ${EDGES} (id, source_node_id, target_node_id, effect, lifetime, priority,
      condition, secret_name, grant_patterns, delay_ms, enabled, created_at, updated_at)
    VALUES (@id, @sourceNodeId, @targetNodeId, @effect, @lifetime, @priority,
      @condition, @secretName, @grantPatterns, @delayMs, @enabled, @createdAt, @updatedAt)`,

  selectEdgeById: `SELECT * FROM ${EDGES} WHERE id = ?`,
  selectEdgesFromSource: `SELECT * FROM ${EDGES} WHERE source_node_id = ? ORDER BY priority DESC`,
  selectEdgesToTarget: `SELECT * FROM ${EDGES} WHERE target_node_id = ? ORDER BY priority DESC`,
  deleteEdge: `DELETE FROM ${EDGES} WHERE id = ?`,

  selectAllEdgesByScope: (scopeClause: string) => `
    SELECT pe.* FROM ${EDGES} pe
    JOIN ${NODES} pn ON pe.source_node_id = pn.id
    WHERE ${scopeClause.replace(/profile_id/g, 'pn.profile_id')}`,

  selectTargetNodeIds: `SELECT target_node_id FROM ${EDGES} WHERE source_node_id = ?`,

  selectAllEdges: `SELECT * FROM ${EDGES}`,

  // ---- Activations ----
  insertActivation: `
    INSERT INTO ${ACTIVATIONS} (id, edge_id, activated_at, expires_at, process_id, consumed)
    VALUES (@id, @edgeId, @activatedAt, @expiresAt, @processId, 0)`,

  selectActiveByEdge: `
    SELECT * FROM ${ACTIVATIONS}
    WHERE consumed = 0 AND (expires_at IS NULL OR expires_at > @now) AND edge_id = @edgeId`,

  selectActiveAll: `
    SELECT * FROM ${ACTIVATIONS}
    WHERE consumed = 0 AND (expires_at IS NULL OR expires_at > @now)`,

  consumeActivation: `UPDATE ${ACTIVATIONS} SET consumed = 1 WHERE id = ?`,

  expireByProcess: `UPDATE ${ACTIVATIONS} SET consumed = 1 WHERE process_id = ? AND consumed = 0`,

  expireBySession: `
    UPDATE ${ACTIVATIONS} SET consumed = 1
    WHERE consumed = 0 AND edge_id IN (
      SELECT id FROM ${EDGES} WHERE lifetime != 'persistent'
    )`,

  pruneExpired: `
    DELETE FROM ${ACTIVATIONS}
    WHERE consumed = 1 OR (expires_at IS NOT NULL AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
} as const;
