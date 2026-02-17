/**
 * Policy engine compiler — unit tests
 */

import type { PolicyConfig, PolicyGraph } from '@agenshield/ipc';
import { compile, operationToTarget } from '../compiler';
import { makePolicy, makeNode, makeEdge, makeActivation } from '../../__tests__/helpers';

describe('operationToTarget', () => {
  it('maps http_request to url', () => {
    expect(operationToTarget('http_request')).toBe('url');
  });

  it('maps exec to command', () => {
    expect(operationToTarget('exec')).toBe('command');
  });

  it('maps file_read to filesystem', () => {
    expect(operationToTarget('file_read')).toBe('filesystem');
  });

  it('maps file_write to filesystem', () => {
    expect(operationToTarget('file_write')).toBe('filesystem');
  });

  it('maps file_list to filesystem', () => {
    expect(operationToTarget('file_list')).toBe('filesystem');
  });

  it('passes through unknown operations', () => {
    expect(operationToTarget('custom_op')).toBe('custom_op');
  });
});

describe('compile', () => {
  describe('basic compilation', () => {
    it('returns a CompiledPolicyEngine', () => {
      const engine = compile({ policies: [] });
      expect(engine).toBeDefined();
      expect(typeof engine.evaluate).toBe('function');
      expect(typeof engine.version).toBe('number');
    });

    it('increments version on successive calls', () => {
      const engine1 = compile({ policies: [] });
      const engine2 = compile({ policies: [] });
      expect(engine2.version).toBeGreaterThan(engine1.version);
    });

    it('compiles with empty policies array', () => {
      const engine = compile({ policies: [] });
      expect(engine).toBeDefined();
    });

    it('filters out disabled policies', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'enabled', action: 'allow', enabled: true }),
        makePolicy({ id: 'disabled', action: 'deny', enabled: false }),
      ];
      const engine = compile({ policies });
      // Only the allow policy should be in the engine
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.allowed).toBe(true);
      expect(result.policyId).toBe('enabled');
    });

    it('uses deny as default action', () => {
      const engine = compile({ policies: [] });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('rule grouping by target type', () => {
    it('groups URL policies into urlRules', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'url-1', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const engine = compile({ policies });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.policyId).toBe('url-1');
    });

    it('groups command policies into commandRules', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'cmd-1', target: 'command', action: 'allow', patterns: ['git:*'] }),
      ];
      const engine = compile({ policies });
      const result = engine.evaluate({
        operation: 'exec',
        target: 'git push',
      });
      expect(result.policyId).toBe('cmd-1');
    });

    it('groups filesystem policies into filesystemRules', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'fs-1', target: 'filesystem', action: 'allow', patterns: ['/etc/**'] }),
      ];
      const engine = compile({ policies });
      const result = engine.evaluate({
        operation: 'file_read',
        target: '/etc/passwd',
      });
      expect(result.policyId).toBe('fs-1');
    });

    it('does not cross target types', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'url-1', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const engine = compile({ policies });
      const result = engine.evaluate({
        operation: 'exec',
        target: 'example.com',
      });
      expect(result.policyId).toBeUndefined();
    });
  });

  describe('priority sorting', () => {
    it('sorts rules by priority DESC within groups', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'low', target: 'url', action: 'allow', patterns: ['example.com'], priority: 10 }),
        makePolicy({ id: 'high', target: 'url', action: 'deny', patterns: ['example.com'], priority: 100 }),
      ];
      const engine = compile({ policies });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.policyId).toBe('high');
      expect(result.allowed).toBe(false);
    });

    it('handles null priority as 0', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'no-priority', target: 'url', action: 'allow', patterns: ['example.com'], priority: undefined }),
        makePolicy({ id: 'with-priority', target: 'url', action: 'deny', patterns: ['example.com'], priority: 1 }),
      ];
      const engine = compile({ policies });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.policyId).toBe('with-priority');
    });
  });

  describe('graph dormant filtering', () => {
    it('excludes dormant policies without activation', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'p-dormant', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p-dormant', true)],
        edges: [],
        activations: [],
      };
      const engine = compile({ policies, graph });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.policyId).toBeUndefined();
      expect(result.allowed).toBe(false);
    });

    it('includes dormant policies with active activation', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'p-active', target: 'url', action: 'allow', patterns: ['example.com'] }),
        makePolicy({ id: 'p-dormant', target: 'url', action: 'allow', patterns: ['other.com'] }),
      ];
      const graph: PolicyGraph = {
        nodes: [
          makeNode('n1', 'p-active'),
          makeNode('n2', 'p-dormant', true),
        ],
        edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' })],
        activations: [makeActivation('act-1', 'e1')],
      };
      const engine = compile({ policies, graph });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://other.com',
      });
      expect(result.policyId).toBe('p-dormant');
      expect(result.allowed).toBe(true);
    });

    it('includes non-dormant graph nodes always', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'p-normal', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p-normal', false)],
        edges: [],
        activations: [],
      };
      const engine = compile({ policies, graph });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.policyId).toBe('p-normal');
    });

    it('includes policies not in graph at all', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'no-node', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const graph: PolicyGraph = {
        nodes: [],
        edges: [],
        activations: [],
      };
      const engine = compile({ policies, graph });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.policyId).toBe('no-node');
    });
  });

  describe('graph effects precomputation', () => {
    it('precomputes grant_network patterns', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'p1', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
        edges: [makeEdge('e1', 'n1', 'n2', {
          effect: 'grant_network',
          grantPatterns: ['*.api.com'],
        })],
        activations: [],
      };
      const engine = compile({ policies, graph });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.effects).toBeDefined();
      expect(result.effects!.grantedNetworkPatterns).toEqual(['*.api.com']);
    });

    it('precomputes grant_fs paths', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'p1', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
        edges: [makeEdge('e1', 'n1', 'n2', {
          effect: 'grant_fs',
          grantPatterns: ['r:/data/read', 'w:/data/write'],
        })],
        activations: [],
      };
      const engine = compile({ policies, graph });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.effects!.grantedFsPaths.read).toEqual(['/data/read']);
      expect(result.effects!.grantedFsPaths.write).toEqual(['/data/write']);
    });

    it('precomputes activate policy IDs', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'p1', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p-target', true)],
        edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' })],
        activations: [],
      };
      const engine = compile({ policies, graph });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.effects!.activatedPolicyIds).toContain('p-target');
    });

    it('precomputes deny flag', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'p1', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
        edges: [makeEdge('e1', 'n1', 'n2', {
          effect: 'deny',
          condition: 'blocked by graph',
        })],
        activations: [],
      };
      const engine = compile({ policies, graph });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      // Graph deny overrides allow
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked by graph');
    });

    it('no effects when policy has no graph edges', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'p1', target: 'url', action: 'allow', patterns: ['example.com'] }),
      ];
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p1')],
        edges: [],
        activations: [],
      };
      const engine = compile({ policies, graph });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      // No edges -> no precomputed effects
      expect(result.effects).toBeUndefined();
    });
  });

  describe('scope and operations', () => {
    it('wires policyScopeMatches into compiled rules', () => {
      const policies: PolicyConfig[] = [
        makePolicy({ id: 'agent-only', target: 'url', action: 'allow', patterns: ['example.com'], scope: 'agent' }),
      ];
      const engine = compile({ policies });

      // Agent context should match
      const result1 = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
        context: { callerType: 'agent', depth: 0 },
      });
      expect(result1.policyId).toBe('agent-only');

      // Skill context should not match
      const result2 = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
        context: { callerType: 'skill', skillSlug: 'test', depth: 0 },
      });
      expect(result2.policyId).toBeUndefined();
    });

    it('builds operations Set from policy', () => {
      const policies: PolicyConfig[] = [
        makePolicy({
          id: 'fs-read-only',
          target: 'filesystem',
          action: 'allow',
          patterns: ['/etc/**'],
          operations: ['file_read'],
        }),
      ];
      const engine = compile({ policies });

      // file_read should match
      const result1 = engine.evaluate({ operation: 'file_read', target: '/etc/passwd' });
      expect(result1.policyId).toBe('fs-read-only');

      // file_write should not match the operations filter
      const result2 = engine.evaluate({ operation: 'file_write', target: '/etc/passwd' });
      expect(result2.policyId).toBeUndefined();
    });
  });
});
