/**
 * Dormant policy activation tracking.
 *
 * A dormant policy is "active" if:
 * - Any incoming `activate` edge has a non-expired, non-consumed activation, OR
 * - Any incoming `activate` edge has `persistent` lifetime (always active)
 */

import type { PolicyGraph } from '@agenshield/ipc';

/**
 * Get the set of dormant policy IDs that have been activated by graph edges.
 *
 * Activations are filtered by:
 * - consumed flag (already used for 'once' lifetime)
 * - expiresAt TTL (expired activations are treated as inactive)
 */
export function getActiveDormantPolicyIds(graph: PolicyGraph): Set<string> {
  const activeIds = new Set<string>();
  const now = new Date().toISOString();

  // Build a set of edge IDs that have active, non-expired activations
  const edgesWithActiveActivation = new Set(
    graph.activations
      .filter(a => !a.consumed && (!a.expiresAt || a.expiresAt > now))
      .map(a => a.edgeId),
  );

  // Find dormant nodes
  const dormantNodes = graph.nodes.filter(n => n.dormant);

  for (const node of dormantNodes) {
    // Check incoming edges to this dormant node
    const incomingActivateEdges = graph.edges.filter(
      e => e.targetNodeId === node.id && e.effect === 'activate' && e.enabled,
    );

    for (const edge of incomingActivateEdges) {
      // Persistent edges are always active (no activation record needed)
      if (edge.lifetime === 'persistent') {
        activeIds.add(node.policyId);
        break;
      }

      // Check if this edge has an active activation
      if (edgesWithActiveActivation.has(edge.id)) {
        activeIds.add(node.policyId);
        break;
      }
    }
  }

  return activeIds;
}
