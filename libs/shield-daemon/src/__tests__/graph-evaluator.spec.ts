/**
 * Graph evaluator — unit tests
 *
 * Tests evaluateGraphEffects() and getActiveDormantPolicyIds() with
 * hand-built PolicyGraph objects. Repository methods are mocked.
 */

import type { PolicyGraph, PolicyNode, PolicyEdge, EdgeActivation } from '@agenshield/ipc';
import { evaluateGraphEffects, getActiveDormantPolicyIds, emptyEffects } from '../policy/graph-evaluator';

// ─── Helpers ────────────────────────────────────────────────────

function makeNode(id: string, policyId: string, dormant = false): PolicyNode {
  return {
    id,
    policyId,
    dormant,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

function makeEdge(
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

function makeActivation(id: string, edgeId: string, overrides: Partial<EdgeActivation> = {}): EdgeActivation {
  return {
    id,
    edgeId,
    activatedAt: '2025-01-01T00:00:00.000Z',
    consumed: false,
    ...overrides,
  };
}

/** Build a mock PolicyGraphRepository */
function mockGraphRepo() {
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
function mockSecretsRepo(secrets: Record<string, string> = {}) {
  return {
    getByName: jest.fn((name: string) => {
      if (name in secrets) return { value: secrets[name] };
      return null;
    }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('evaluateGraphEffects', () => {
  it('returns empty effects when policy has no node in graph', () => {
    const graph: PolicyGraph = { nodes: [], edges: [], activations: [] };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('unknown-policy', graph, repo as never, secrets);

    expect(effects.grantedNetworkPatterns).toEqual([]);
    expect(effects.grantedFsPaths.read).toEqual([]);
    expect(effects.grantedFsPaths.write).toEqual([]);
    expect(effects.injectedSecrets).toEqual({});
    expect(effects.activatedPolicyIds).toEqual([]);
    expect(effects.denied).toBe(false);
  });

  it('returns empty effects when node has no outgoing edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1')],
      edges: [],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects).toEqual(emptyEffects());
  });

  it('collects grant_network patterns', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'grant_network',
          grantPatterns: ['*.gogl.com', 'api.example.com'],
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.grantedNetworkPatterns).toEqual(['*.gogl.com', 'api.example.com']);
  });

  it('collects grant_fs read paths (default)', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'grant_fs',
          grantPatterns: ['/data/gog', '/tmp/output'],
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.grantedFsPaths.read).toEqual(['/data/gog', '/tmp/output']);
    expect(effects.grantedFsPaths.write).toEqual([]);
  });

  it('collects grant_fs read and write paths with prefixes', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'grant_fs',
          grantPatterns: ['r:/data/read', 'w:/data/write', '/data/default'],
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.grantedFsPaths.read).toEqual(['/data/read', '/data/default']);
    expect(effects.grantedFsPaths.write).toEqual(['/data/write']);
  });

  it('injects secrets when available', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'inject_secret',
          secretName: 'GOG_TOKEN',
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo({ GOG_TOKEN: 'secret-value-123' });

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.injectedSecrets).toEqual({ GOG_TOKEN: 'secret-value-123' });
    expect(secrets.getByName).toHaveBeenCalledWith('GOG_TOKEN');
  });

  it('skips inject_secret when secret not found', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'inject_secret',
          secretName: 'MISSING_SECRET',
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.injectedSecrets).toEqual({});
  });

  it('creates activation for activate edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [
        makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.activatedPolicyIds).toEqual(['p2']);
    expect(repo.activate).toHaveBeenCalledWith({ edgeId: 'e1' });
  });

  it('creates activation with processId for process-scoped edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [
        makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'process' }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets, {
      esPid: 42,
      callerType: 'agent',
    });

    expect(repo.activate).toHaveBeenCalledWith({ edgeId: 'e1', processId: 42 });
    expect(effects.activatedPolicyIds).toEqual(['p2']);
  });

  it('does not create activation for persistent edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [
        makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'persistent' }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.activatedPolicyIds).toEqual(['p2']);
    expect(repo.activate).not.toHaveBeenCalled();
  });

  it('deny edge sets denied flag', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'deny',
          condition: 'Prohibited operation chain',
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.denied).toBe(true);
    expect(effects.denyReason).toBe('Prohibited operation chain');
  });

  it('revoke edge consumes activations on target', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2'), makeNode('n3', 'p3')],
      edges: [
        // n3 -> n2 activation edge (pre-existing)
        makeEdge('e-activate', 'n3', 'n2', { effect: 'activate' }),
        // n1 -> n2 revoke edge
        makeEdge('e-revoke', 'n1', 'n2', { effect: 'revoke' }),
      ],
      activations: [makeActivation('act-1', 'e-activate')],
    };

    // Set up mock with existing activation
    const repo = mockGraphRepo();
    repo._activations.push(makeActivation('act-1', 'e-activate'));

    const secrets = mockSecretsRepo();

    evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(repo.consumeActivation).toHaveBeenCalledWith('act-1');
  });

  it('skips disabled edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'grant_network',
          grantPatterns: ['*.example.com'],
          enabled: false,
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.grantedNetworkPatterns).toEqual([]);
  });

  it('processes edges in priority order (highest first)', () => {
    const activatedOrder: string[] = [];
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2'), makeNode('n3', 'p3')],
      edges: [
        makeEdge('e-low', 'n1', 'n2', { effect: 'activate', priority: 1, lifetime: 'session' }),
        makeEdge('e-high', 'n1', 'n3', { effect: 'activate', priority: 10, lifetime: 'session' }),
      ],
      activations: [],
    };

    const repo = mockGraphRepo();
    repo.activate.mockImplementation((params: { edgeId: string }) => {
      activatedOrder.push(params.edgeId);
      return { id: 'a', edgeId: params.edgeId, activatedAt: '', consumed: false };
    });
    const secrets = mockSecretsRepo();

    evaluateGraphEffects('p1', graph, repo as never, secrets);

    // High priority edge should fire first
    expect(activatedOrder).toEqual(['e-high', 'e-low']);
  });

  it('aggregates effects from multiple edges', () => {
    const graph: PolicyGraph = {
      nodes: [
        makeNode('n1', 'p-gog'),
        makeNode('n2', 'p-openai', true),
        makeNode('n3', 'p-jira', true),
      ],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'grant_network',
          grantPatterns: ['gogl.com'],
        }),
        makeEdge('e2', 'n1', 'n2', {
          effect: 'activate',
          lifetime: 'session',
        }),
        makeEdge('e3', 'n1', 'n3', {
          effect: 'activate',
          lifetime: 'session',
        }),
        makeEdge('e4', 'n1', 'n3', {
          effect: 'inject_secret',
          secretName: 'JIRA_TOKEN',
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo({ JIRA_TOKEN: 'jira-secret' });

    const effects = evaluateGraphEffects('p-gog', graph, repo as never, secrets);

    expect(effects.grantedNetworkPatterns).toEqual(['gogl.com']);
    expect(effects.activatedPolicyIds).toContain('p-openai');
    expect(effects.activatedPolicyIds).toContain('p-jira');
    expect(effects.injectedSecrets).toEqual({ JIRA_TOKEN: 'jira-secret' });
    expect(effects.denied).toBe(false);
  });

  it('is fault-tolerant: edge failure does not block other edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2'), makeNode('n3', 'p3')],
      edges: [
        makeEdge('e-fail', 'n1', 'n2', { effect: 'inject_secret', secretName: 'CRASH' }),
        makeEdge('e-ok', 'n1', 'n3', { effect: 'grant_network', grantPatterns: ['ok.com'] }),
      ],
      activations: [],
    };

    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();
    // Make getByName throw for CRASH
    secrets.getByName.mockImplementation((name: string) => {
      if (name === 'CRASH') throw new Error('Vault exploded');
      return null;
    });

    // Should not throw
    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    // The OK edge should still have been processed
    expect(effects.grantedNetworkPatterns).toEqual(['ok.com']);
  });
});

describe('getActiveDormantPolicyIds', () => {
  it('returns empty set when no dormant nodes', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1', false)],
      edges: [],
      activations: [],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.size).toBe(0);
  });

  it('returns empty set when dormant node has no incoming activate edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1', true)],
      edges: [],
      activations: [],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.size).toBe(0);
  });

  it('activates dormant node when incoming activate edge has active activation', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' })],
      activations: [makeActivation('act-1', 'e1')],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(true);
  });

  it('does not activate dormant node when activation is consumed', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' })],
      activations: [makeActivation('act-1', 'e1', { consumed: true })],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(false);
  });

  it('activates dormant node for persistent edges without activation', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'persistent' })],
      activations: [],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(true);
  });

  it('ignores disabled edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'persistent', enabled: false })],
      activations: [],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(false);
  });

  it('ignores non-activate edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'grant_network', lifetime: 'session' })],
      activations: [makeActivation('act-1', 'e1')],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(false);
  });

  it('handles multiple dormant nodes with mixed activation states', () => {
    const graph: PolicyGraph = {
      nodes: [
        makeNode('n1', 'p-root'),
        makeNode('n2', 'p-openai', true),
        makeNode('n3', 'p-jira', true),
        makeNode('n4', 'p-slack', true),
      ],
      edges: [
        makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' }),
        makeEdge('e2', 'n1', 'n3', { effect: 'activate', lifetime: 'session' }),
        makeEdge('e3', 'n1', 'n4', { effect: 'activate', lifetime: 'session' }),
      ],
      activations: [
        makeActivation('act-1', 'e1'), // openai activated
        // jira: no activation
        makeActivation('act-3', 'e3', { consumed: true }), // slack consumed
      ],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p-openai')).toBe(true);
    expect(result.has('p-jira')).toBe(false);
    expect(result.has('p-slack')).toBe(false);
  });
});
