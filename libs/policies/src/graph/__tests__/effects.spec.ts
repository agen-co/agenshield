/**
 * Graph effects evaluator — unit tests
 *
 * Ported from libs/shield-daemon/src/__tests__/graph-evaluator.spec.ts
 * Tests evaluateGraphEffects() with hand-built PolicyGraph objects.
 */

import type { PolicyGraph } from '@agenshield/ipc';
import { evaluateGraphEffects, emptyEffects } from '../effects';
import {
  makeNode,
  makeEdge,
  makeActivation,
  mockGraphRepo,
  mockSecretsRepo,
} from '../../__tests__/helpers';

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
      nativePid: 42,
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
        makeEdge('e-activate', 'n3', 'n2', { effect: 'activate' }),
        makeEdge('e-revoke', 'n1', 'n2', { effect: 'revoke' }),
      ],
      activations: [makeActivation('act-1', 'e-activate')],
    };

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

  // ─── Constraint modes ────────────────────────────────────────

  it('sequential constraint: defers activation instead of immediate', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'activate',
          lifetime: 'session',
          constraint: 'sequential',
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    // Should NOT create an immediate activation
    expect(repo.activate).not.toHaveBeenCalled();
    expect(effects.activatedPolicyIds).toEqual([]);

    // Should record a deferred activation
    expect(effects.deferredActivations).toEqual([
      { edgeId: 'e1', targetPolicyId: 'p2' },
    ]);
  });

  it('timed constraint: creates activation with expiresAt TTL', () => {
    const now = Date.now();
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'activate',
          lifetime: 'session',
          constraint: 'timed',
          activationDurationMs: 300_000, // 5 minutes
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    // Should create activation with expiresAt
    expect(repo.activate).toHaveBeenCalledTimes(1);
    const activateCall = repo.activate.mock.calls[0][0];
    expect(activateCall.edgeId).toBe('e1');
    expect(activateCall.expiresAt).toBeDefined();

    // Verify expiresAt is approximately now + 5 minutes
    const expiresAt = new Date(activateCall.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(now + 299_000);
    expect(expiresAt).toBeLessThanOrEqual(now + 301_000);

    expect(effects.activatedPolicyIds).toEqual(['p2']);
    expect(effects.deferredActivations).toEqual([]);
  });

  it('timed constraint without activationDurationMs: falls through to concurrent', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'activate',
          lifetime: 'session',
          constraint: 'timed',
          // No activationDurationMs — falls through to concurrent
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    // Should create immediate activation (concurrent fallback)
    expect(repo.activate).toHaveBeenCalledWith({ edgeId: 'e1' });
    expect(effects.activatedPolicyIds).toEqual(['p2']);
    expect(effects.deferredActivations).toEqual([]);
  });

  it('concurrent constraint (explicit): activates immediately', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [
        makeEdge('e1', 'n1', 'n2', {
          effect: 'activate',
          lifetime: 'session',
          constraint: 'concurrent',
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(repo.activate).toHaveBeenCalledWith({ edgeId: 'e1' });
    expect(effects.activatedPolicyIds).toEqual(['p2']);
    expect(effects.deferredActivations).toEqual([]);
  });

  // ─── Deny short-circuit ───────────────────────────────────

  it('deny edge short-circuits: subsequent edges are not evaluated', () => {
    const graph: PolicyGraph = {
      nodes: [
        makeNode('n1', 'p1'),
        makeNode('n2', 'p2'),
        makeNode('n3', 'p3'),
      ],
      edges: [
        // High priority: deny
        makeEdge('e-deny', 'n1', 'n2', {
          effect: 'deny',
          priority: 10,
          condition: 'Blocked',
        }),
        // Low priority: grant network (should be skipped)
        makeEdge('e-grant', 'n1', 'n3', {
          effect: 'grant_network',
          priority: 1,
          grantPatterns: ['*.example.com'],
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.denied).toBe(true);
    expect(effects.denyReason).toBe('Blocked');
    // Grant after deny should be skipped
    expect(effects.grantedNetworkPatterns).toEqual([]);
  });

  // ─── Max edge guard ───────────────────────────────────────

  it('limits evaluation to MAX_EDGE_EVALUATIONS (50)', () => {
    const nodes = [makeNode('n1', 'p-source')];
    const edges: PolicyGraph['edges'] = [];

    // Create 60 edges — only first 50 should be processed
    for (let i = 0; i < 60; i++) {
      const targetId = `n-target-${i}`;
      nodes.push(makeNode(targetId, `p-target-${i}`));
      edges.push(
        makeEdge(`e-${i}`, 'n1', targetId, {
          effect: 'grant_network',
          priority: 60 - i, // Descending priority
          grantPatterns: [`host-${i}.com`],
        }),
      );
    }

    const graph: PolicyGraph = { nodes, edges, activations: [] };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    // Suppress the console.warn about exceeding MAX_EDGE_EVALUATIONS
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const effects = evaluateGraphEffects('p-source', graph, repo as never, secrets);

    // Should have 50 patterns (not 60)
    expect(effects.grantedNetworkPatterns).toHaveLength(50);

    // Console.warn should have been called about exceeding limit
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('60 outgoing edges'),
    );

    warnSpy.mockRestore();
  });

  // ─── Deferred activations in mixed scenarios ──────────────

  it('mixed: sequential + concurrent edges produce both immediate and deferred', () => {
    const graph: PolicyGraph = {
      nodes: [
        makeNode('n1', 'p-gog'),
        makeNode('n2', 'p-openai', true),
        makeNode('n3', 'p-jira', true),
      ],
      edges: [
        // Concurrent → immediate
        makeEdge('e1', 'n1', 'n2', {
          effect: 'activate',
          lifetime: 'session',
          constraint: 'concurrent',
        }),
        // Sequential → deferred
        makeEdge('e2', 'n1', 'n3', {
          effect: 'activate',
          lifetime: 'session',
          constraint: 'sequential',
        }),
      ],
      activations: [],
    };
    const repo = mockGraphRepo();
    const secrets = mockSecretsRepo();

    const effects = evaluateGraphEffects('p-gog', graph, repo as never, secrets);

    // Concurrent: activated immediately
    expect(effects.activatedPolicyIds).toEqual(['p-openai']);
    expect(repo.activate).toHaveBeenCalledWith({ edgeId: 'e1' });

    // Sequential: deferred
    expect(effects.deferredActivations).toEqual([
      { edgeId: 'e2', targetPolicyId: 'p-jira' },
    ]);
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
    secrets.getByName.mockImplementation((name: string) => {
      if (name === 'CRASH') throw new Error('Vault exploded');
      return null;
    });

    const effects = evaluateGraphEffects('p1', graph, repo as never, secrets);

    expect(effects.grantedNetworkPatterns).toEqual(['ok.com']);
  });
});
