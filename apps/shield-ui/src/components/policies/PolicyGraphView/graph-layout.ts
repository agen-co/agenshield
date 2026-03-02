/**
 * graph-layout.ts — Transform PolicyGraph + PolicyConfig[] into ReactFlow nodes/edges.
 *
 * Implements a basic layered DAG layout using topological sort.
 * No external dependency needed — graphs are small.
 */

import type { Node, Edge } from '@xyflow/react';
import type { PolicyGraph, PolicyConfig, PolicyEdge } from '@agenshield/ipc';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const HORIZONTAL_GAP = 80;
const VERTICAL_GAP = 60;

export type PolicyNodeData = Record<string, unknown> & {
  policyId: string;
  policyName: string;
  target: PolicyConfig['target'];
  action: PolicyConfig['action'];
  patterns: string[];
  dormant: boolean;
  activated: boolean;
};

export type PolicyEdgeData = Record<string, unknown> & {
  effect: PolicyEdge['effect'];
  lifetime: PolicyEdge['lifetime'];
  condition?: string;
  secretName?: string;
  grantPatterns?: string[];
  active: boolean;
};

/**
 * Topological sort of policy graph nodes.
 * Returns layers (arrays of node IDs) for left-to-right layout.
 */
function topologicalLayers(
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>,
): string[][] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const layers: string[][] = [];
  let current = nodeIds.filter(id => (inDegree.get(id) ?? 0) === 0);

  while (current.length > 0) {
    layers.push([...current]);
    const next: string[] = [];
    for (const id of current) {
      for (const neighbor of adjacency.get(id) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          next.push(neighbor);
        }
      }
    }
    current = next;
  }

  // Add any remaining nodes not in layers (cycles — shouldn't happen but be safe)
  const placed = new Set(layers.flat());
  const remaining = nodeIds.filter(id => !placed.has(id));
  if (remaining.length > 0) {
    layers.push(remaining);
  }

  return layers;
}

/**
 * Build ReactFlow nodes and edges from PolicyGraph + policies.
 */
export function buildFlowElements(
  graph: PolicyGraph,
  policies: PolicyConfig[],
): { nodes: Node<PolicyNodeData>[]; edges: Edge<PolicyEdgeData>[] } {
  const policyMap = new Map(policies.map(p => [p.id, p]));

  // Build active activation set for edge glow
  const activeEdgeIds = new Set(
    graph.activations
      .filter(a => !a.consumed)
      .map(a => a.edgeId),
  );

  // Build activated policy IDs
  const activatedPolicyIds = new Set<string>();
  for (const activation of graph.activations) {
    if (activation.consumed) continue;
    const edge = graph.edges.find(e => e.id === activation.edgeId);
    if (edge?.effect === 'activate') {
      const targetNode = graph.nodes.find(n => n.id === edge.targetNodeId);
      if (targetNode) activatedPolicyIds.add(targetNode.policyId);
    }
  }

  // Map graph node IDs to sorted edges for layout
  const layoutEdges = graph.edges
    .filter(e => e.enabled)
    .map(e => ({ source: e.sourceNodeId, target: e.targetNodeId }));

  const graphNodeIds = graph.nodes.map(n => n.id);
  const layers = topologicalLayers(graphNodeIds, layoutEdges);

  // Position nodes in layers
  const flowNodes: Node<PolicyNodeData>[] = [];

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    const layerHeight = layer.length * (NODE_HEIGHT + VERTICAL_GAP) - VERTICAL_GAP;
    const startY = -layerHeight / 2;

    for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
      const graphNodeId = layer[nodeIdx];
      const graphNode = graph.nodes.find(n => n.id === graphNodeId);
      if (!graphNode) continue;

      const policy = policyMap.get(graphNode.policyId);

      flowNodes.push({
        id: graphNodeId,
        type: 'policyNode',
        position: {
          x: layerIdx * (NODE_WIDTH + HORIZONTAL_GAP),
          y: startY + nodeIdx * (NODE_HEIGHT + VERTICAL_GAP),
        },
        data: {
          policyId: graphNode.policyId,
          policyName: policy?.name ?? graphNode.policyId,
          target: policy?.target ?? 'command',
          action: policy?.action ?? 'allow',
          patterns: policy?.patterns ?? [],
          dormant: graphNode.dormant,
          activated: activatedPolicyIds.has(graphNode.policyId),
        },
      });
    }
  }

  // Build edges
  const flowEdges: Edge<PolicyEdgeData>[] = graph.edges
    .filter(e => e.enabled)
    .map(e => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      type: 'policyEdge',
      animated: activeEdgeIds.has(e.id),
      data: {
        effect: e.effect,
        lifetime: e.lifetime,
        condition: e.condition,
        secretName: e.secretName,
        grantPatterns: e.grantPatterns,
        active: activeEdgeIds.has(e.id),
      },
    }));

  return { nodes: flowNodes, edges: flowEdges };
}
