/**
 * Shared test helpers for @agenshield/policies
 *
 * Factories and mocks used across test files. NOT a spec file.
 */

import type {
  PolicyConfig,
  PolicyGraph,
  PolicyNode,
  PolicyEdge,
  EdgeActivation,
} from '@agenshield/ipc';

// ─── Factories ───────────────────────────────────────────────

export function makePolicy(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    id: 'test-policy',
    name: 'Test Policy',
    action: 'deny',
    target: 'url',
    patterns: ['example.com'],
    enabled: true,
    priority: 100,
    ...overrides,
  };
}

export function makeNode(id: string, policyId: string, dormant = false): PolicyNode {
  return {
    id,
    policyId,
    dormant,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

export function makeEdge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  overrides: Partial<PolicyEdge> = {},
): PolicyEdge {
  return {
    id,
    sourceNodeId,
    targetNodeId,
    effect: 'activate',
    lifetime: 'session',
    priority: 0,
    enabled: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeActivation(
  id: string,
  edgeId: string,
  overrides: Partial<EdgeActivation> = {},
): EdgeActivation {
  return {
    id,
    edgeId,
    activatedAt: '2025-01-01T00:00:00.000Z',
    consumed: false,
    ...overrides,
  };
}

export function makeGraph(
  nodes: PolicyNode[],
  edges: PolicyEdge[],
  activations: EdgeActivation[] = [],
): PolicyGraph {
  return { nodes, edges, activations };
}

// ─── Mocks ───────────────────────────────────────────────────

/** Build a mock PolicyGraphRepository */
export function mockGraphRepo() {
  const activations: EdgeActivation[] = [];
  const consumed = new Set<string>();

  return {
    activate: jest.fn((params: { edgeId: string; processId?: number; expiresAt?: string }) => {
      const act: EdgeActivation = {
        id: `act-${activations.length}`,
        edgeId: params.edgeId,
        activatedAt: new Date().toISOString(),
        processId: params.processId,
        expiresAt: params.expiresAt,
        consumed: false,
      };
      activations.push(act);
      return act;
    }),
    getActiveActivations: jest.fn((edgeId?: string) => {
      return activations.filter(a => {
        if (consumed.has(a.id)) return false;
        if (edgeId && a.edgeId !== edgeId) return false;
        return true;
      });
    }),
    consumeActivation: jest.fn((id: string) => {
      consumed.add(id);
    }),
    _activations: activations,
    _consumed: consumed,
  };
}

/** Build a mock SecretsRepository */
export function mockSecretsRepo(secrets: Record<string, string> = {}) {
  return {
    getByName: jest.fn((name: string) => {
      if (name in secrets) return { value: secrets[name] };
      return null;
    }),
  };
}
