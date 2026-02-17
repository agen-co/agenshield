/**
 * Policy Graph Effects Evaluator
 *
 * Evaluates outgoing graph edges when a policy matches.
 * Produces effects: grant_network, grant_fs, inject_secret, activate, deny, revoke.
 *
 * Fail-open: if graph evaluation throws, the caller gets EMPTY_EFFECTS
 * and falls back to the flat policy result. Never blocks a legitimate allow/deny.
 */

import type {
  PolicyGraph, PolicyEdge,
} from '@agenshield/ipc';
import type { PolicyGraphRepository } from '@agenshield/storage';
import type { PolicyExecutionContext } from '@agenshield/ipc';

/** Deferred activation for sequential constraint edges */
export interface DeferredActivation {
  edgeId: string;
  targetPolicyId: string;
}

export interface GraphEffects {
  grantedNetworkPatterns: string[];
  grantedFsPaths: { read: string[]; write: string[] };
  injectedSecrets: Record<string, string>;
  activatedPolicyIds: string[];
  denied: boolean;
  denyReason?: string;
  /** Activations deferred until source trace completes (sequential constraint) */
  deferredActivations: DeferredActivation[];
}

/** Maximum number of edge evaluations per call (prevents runaway graphs) */
const MAX_EDGE_EVALUATIONS = 50;

/** Create a fresh empty effects object (avoids shared mutable reference) */
export function emptyEffects(): GraphEffects {
  return {
    grantedNetworkPatterns: [],
    grantedFsPaths: { read: [], write: [] },
    injectedSecrets: {},
    activatedPolicyIds: [],
    denied: false,
    deferredActivations: [],
  };
}

export interface SecretsResolver {
  getByName(name: string): { value: string } | null;
}

/**
 * Resolve secret value by name from scoped secrets repository.
 * Returns undefined if secret not found or vault is locked.
 */
function resolveSecret(
  secretsRepo: SecretsResolver,
  secretName: string,
): string | undefined {
  try {
    const secret = secretsRepo.getByName(secretName);
    return secret?.value;
  } catch {
    // StorageLockedError or other vault access issues
    return undefined;
  }
}

/**
 * Evaluate graph effects for a matched policy.
 *
 * Only fires direct outgoing edges from the matched policy's node.
 * No recursive traversal — cascading happens across separate evaluation calls
 * via the session activation model.
 */
export function evaluateGraphEffects(
  matchedPolicyId: string,
  graph: PolicyGraph,
  graphRepo: PolicyGraphRepository,
  secretsRepo: SecretsResolver,
  context?: PolicyExecutionContext,
): GraphEffects {
  const effects = emptyEffects();

  // Find the matched policy's node in the graph
  const node = graph.nodes.find(n => n.policyId === matchedPolicyId);
  if (!node) return effects;

  // Get outgoing edges from this node, enabled only, sorted by priority desc
  const outgoingEdges = graph.edges
    .filter(e => e.sourceNodeId === node.id && e.enabled)
    .sort((a, b) => b.priority - a.priority);

  if (outgoingEdges.length === 0) return effects;

  // Guard: limit edge evaluations to prevent runaway graphs
  const edgesToEvaluate = outgoingEdges.slice(0, MAX_EDGE_EVALUATIONS);
  if (outgoingEdges.length > MAX_EDGE_EVALUATIONS) {
    console.warn(
      `[graph-eval] Node ${node.id} has ${outgoingEdges.length} outgoing edges, evaluating first ${MAX_EDGE_EVALUATIONS}`,
    );
  }

  for (const edge of edgesToEvaluate) {
    // Deny short-circuit: once denied, stop evaluating further edges
    if (effects.denied) break;

    try {
      applyEdgeEffect(edge, graph, graphRepo, secretsRepo, effects, context);
    } catch (err) {
      // Fault-tolerance: log warning, skip edge, never block the original policy result
      console.warn(
        `[graph-eval] Edge ${edge.id} (${edge.effect}) failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return effects;
}

/**
 * Apply a single edge's effect to the accumulating GraphEffects.
 */
function applyEdgeEffect(
  edge: PolicyEdge,
  graph: PolicyGraph,
  graphRepo: PolicyGraphRepository,
  secretsRepo: SecretsResolver,
  effects: GraphEffects,
  context?: PolicyExecutionContext,
): void {
  switch (edge.effect) {
    case 'grant_network': {
      if (edge.grantPatterns && edge.grantPatterns.length > 0) {
        effects.grantedNetworkPatterns.push(...edge.grantPatterns);
      }
      break;
    }

    case 'grant_fs': {
      if (edge.grantPatterns && edge.grantPatterns.length > 0) {
        // grantPatterns for fs: prefixed with "r:" for read, "w:" for write, or plain (defaults to read)
        for (const pattern of edge.grantPatterns) {
          if (pattern.startsWith('w:')) {
            effects.grantedFsPaths.write.push(pattern.slice(2));
          } else if (pattern.startsWith('r:')) {
            effects.grantedFsPaths.read.push(pattern.slice(2));
          } else {
            // Default: read access
            effects.grantedFsPaths.read.push(pattern);
          }
        }
      }
      break;
    }

    case 'inject_secret': {
      if (edge.secretName) {
        const value = resolveSecret(secretsRepo, edge.secretName);
        if (value !== undefined) {
          effects.injectedSecrets[edge.secretName] = value;
        } else {
          console.warn(`[graph-eval] Secret "${edge.secretName}" not found or vault locked, skipping inject`);
        }
      }
      break;
    }

    case 'activate': {
      // Find the target node to get its policyId
      const targetNode = graph.nodes.find(n => n.id === edge.targetNodeId);
      if (!targetNode) break;

      if (edge.constraint === 'sequential') {
        // Defer — will fire when source trace completes
        effects.deferredActivations.push({
          edgeId: edge.id,
          targetPolicyId: targetNode.policyId,
        });
      } else if (edge.constraint === 'timed' && edge.activationDurationMs) {
        // Time-based — activate now with TTL
        const expiresAt = new Date(Date.now() + edge.activationDurationMs).toISOString();
        graphRepo.activate({ edgeId: edge.id, expiresAt });
        effects.activatedPolicyIds.push(targetNode.policyId);
      } else {
        // Concurrent (default): activate immediately
        const activateParams: { edgeId: string; processId?: number; expiresAt?: string } = {
          edgeId: edge.id,
        };

        // Scope activation by lifetime
        if (edge.lifetime === 'process' && context?.esPid) {
          activateParams.processId = context.esPid;
        }

        // Persistent edges don't need activation records — they're always active
        if (edge.lifetime !== 'persistent') {
          graphRepo.activate(activateParams);
        }

        effects.activatedPolicyIds.push(targetNode.policyId);
      }
      break;
    }

    case 'deny': {
      effects.denied = true;
      effects.denyReason = edge.condition || 'Denied by graph edge';
      break;
    }

    case 'revoke': {
      // Consume existing activations for the target node's incoming edges
      const targetNode = graph.nodes.find(n => n.id === edge.targetNodeId);
      if (!targetNode) break;

      const targetIncomingEdges = graph.edges.filter(e => e.targetNodeId === targetNode.id);
      for (const incoming of targetIncomingEdges) {
        const activations = graphRepo.getActiveActivations(incoming.id);
        for (const activation of activations) {
          graphRepo.consumeActivation(activation.id);
        }
      }
      break;
    }
  }

  // Handle 'once' lifetime: consume the activation after applying
  if (edge.lifetime === 'once') {
    const activations = graphRepo.getActiveActivations(edge.id);
    for (const activation of activations) {
      graphRepo.consumeActivation(activation.id);
    }
  }
}
