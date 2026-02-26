/**
 * CompiledPolicyEngine.evaluate() — unit tests
 */

import { compile } from '../compiler';
import { makePolicy, makeNode, makeEdge } from '../../__tests__/helpers';
import type { PolicyConfig, PolicyGraph } from '@agenshield/ipc';

// Helper: compile and evaluate in one step
function compileAndEvaluate(
  policies: PolicyConfig[],
  input: { operation: string; target: string; context?: import('@agenshield/ipc').PolicyExecutionContext; defaultAction?: 'allow' | 'deny' },
  graph?: PolicyGraph,
) {
  const engine = compile({ policies, graph });
  return engine.evaluate(input);
}

describe('CompiledPolicyEngine.evaluate', () => {
  describe('default action', () => {
    it('denies when no policies match and default is deny', () => {
      const result = compileAndEvaluate([], {
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.allowed).toBe(false);
    });

    it('allows when no policies match and default is allow', () => {
      const result = compileAndEvaluate([], {
        operation: 'http_request',
        target: 'https://example.com',
        defaultAction: 'allow',
      });
      expect(result.allowed).toBe(true);
    });

    it('respects per-evaluate defaultAction override', () => {
      const engine = compile({ policies: [], defaultAction: 'deny' });
      const result = engine.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
        defaultAction: 'allow',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('URL target', () => {
    it('allows URL matching allow policy', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'allow-url', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com' },
      );
      expect(result.allowed).toBe(true);
      expect(result.policyId).toBe('allow-url');
    });

    it('denies URL matching deny policy', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'deny-url', action: 'deny', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com' },
      );
      expect(result.allowed).toBe(false);
    });

    it('respects priority ordering', () => {
      const result = compileAndEvaluate(
        [
          makePolicy({ id: 'low', action: 'allow', target: 'url', patterns: ['example.com'], priority: 1 }),
          makePolicy({ id: 'high', action: 'deny', target: 'url', patterns: ['example.com'], priority: 100 }),
        ],
        { operation: 'http_request', target: 'https://example.com' },
      );
      expect(result.policyId).toBe('high');
      expect(result.allowed).toBe(false);
    });

    it('filters by scope', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'skill-only', action: 'allow', target: 'url', patterns: ['example.com'], scope: 'skill' })],
        { operation: 'http_request', target: 'https://example.com', context: { callerType: 'agent', depth: 0 } },
      );
      expect(result.policyId).toBeUndefined();
    });

    it('returns executionContext in result', () => {
      const ctx = { callerType: 'agent' as const, depth: 0 };
      const result = compileAndEvaluate(
        [makePolicy({ id: 'p1', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com', context: ctx },
      );
      expect(result.executionContext).toBe(ctx);
    });
  });

  describe('plain HTTP blocking', () => {
    it('blocks plain HTTP with no explicit allow', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'allow-https', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'http://example.com' },
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('HTTP');
    });

    it('allows plain HTTP when pattern uses http://', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'allow-http', action: 'allow', target: 'url', patterns: ['http://example.com'] })],
        { operation: 'http_request', target: 'http://example.com' },
      );
      expect(result.allowed).toBe(true);
    });

    it('does not block HTTPS', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'allow-https', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com' },
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('command target', () => {
    it('allows matching command', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'cmd', action: 'allow', target: 'command', patterns: ['git:*'] })],
        { operation: 'exec', target: 'git push' },
      );
      expect(result.allowed).toBe(true);
      expect(result.policyId).toBe('cmd');
    });

    it('denies non-matching command', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'cmd', action: 'allow', target: 'command', patterns: ['git:*'] })],
        { operation: 'exec', target: 'curl https://evil.com' },
      );
      expect(result.allowed).toBe(false);
    });

    it('respects operations filter', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'cmd', action: 'allow', target: 'command', patterns: ['git:*'], operations: ['exec'] })],
        { operation: 'file_read', target: 'git status' },
      );
      // file_read maps to filesystem target type, not command, so this won't match
      expect(result.policyId).toBeUndefined();
    });

    it('matches wildcard *', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'cmd', action: 'allow', target: 'command', patterns: ['*'] })],
        { operation: 'exec', target: 'any-command-here' },
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('filesystem target', () => {
    it('allows matching filesystem path', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'fs', action: 'allow', target: 'filesystem', patterns: ['/tmp/**'] })],
        { operation: 'file_read', target: '/tmp/data.txt' },
      );
      expect(result.allowed).toBe(true);
    });

    it('denies non-matching filesystem path', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'fs', action: 'deny', target: 'filesystem', patterns: ['/etc/**'] })],
        { operation: 'file_read', target: '/etc/passwd' },
      );
      expect(result.allowed).toBe(false);
    });

    it('handles directory trailing slash', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'fs', action: 'allow', target: 'filesystem', patterns: ['/tmp/'] })],
        { operation: 'file_read', target: '/tmp/nested/file.txt' },
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('graph effects', () => {
    it('attaches precomputed effects to result', () => {
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
        edges: [makeEdge('e1', 'n1', 'n2', {
          effect: 'grant_network',
          grantPatterns: ['api.service.com'],
        })],
        activations: [],
      };
      const result = compileAndEvaluate(
        [makePolicy({ id: 'p1', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com' },
        graph,
      );
      expect(result.effects).toBeDefined();
      expect(result.effects!.grantedNetworkPatterns).toContain('api.service.com');
    });

    it('graph deny overrides allow', () => {
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
        edges: [makeEdge('e1', 'n1', 'n2', { effect: 'deny', condition: 'graph-deny' })],
        activations: [],
      };
      const result = compileAndEvaluate(
        [makePolicy({ id: 'p1', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com' },
        graph,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('graph-deny');
    });

    it('includes grant_network in effects', () => {
      const graph: PolicyGraph = {
        nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2')],
        edges: [makeEdge('e1', 'n1', 'n2', {
          effect: 'grant_network',
          grantPatterns: ['*.internal.com'],
        })],
        activations: [],
      };
      const result = compileAndEvaluate(
        [makePolicy({ id: 'p1', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com' },
        graph,
      );
      expect(result.effects!.grantedNetworkPatterns).toEqual(['*.internal.com']);
    });

    it('no effects when policy has no node in graph', () => {
      const graph: PolicyGraph = {
        nodes: [],
        edges: [],
        activations: [],
      };
      const result = compileAndEvaluate(
        [makePolicy({ id: 'orphan', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com' },
        graph,
      );
      expect(result.effects).toBeUndefined();
    });
  });

  describe('operationToTarget routing', () => {
    it('routes http_request to URL rules', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'url', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com' },
      );
      expect(result.policyId).toBe('url');
    });

    it('routes exec to command rules', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'cmd', action: 'allow', target: 'command', patterns: ['*'] })],
        { operation: 'exec', target: 'ls' },
      );
      expect(result.policyId).toBe('cmd');
    });

    it('routes file_read to filesystem rules', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'fs', action: 'allow', target: 'filesystem', patterns: ['/**'] })],
        { operation: 'file_read', target: '/etc/passwd' },
      );
      expect(result.policyId).toBe('fs');
    });

    it('routes file_write to filesystem rules', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'fs', action: 'allow', target: 'filesystem', patterns: ['/tmp/**'] })],
        { operation: 'file_write', target: '/tmp/output.txt' },
      );
      expect(result.policyId).toBe('fs');
    });
  });

  describe('unknown operation', () => {
    it('falls to default action for unknown target type', () => {
      const result = compileAndEvaluate(
        [makePolicy({ id: 'url', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'custom_unknown', target: 'anything' },
      );
      expect(result.policyId).toBeUndefined();
      expect(result.allowed).toBe(false);
    });
  });

  describe('evaluateProcess', () => {
    it('returns null when no deny rules exist', () => {
      const engine = compile({ policies: [] });
      expect(engine.evaluateProcess('openclaw run')).toBeNull();
    });

    it('returns null when only allow rules exist', () => {
      const engine = compile({
        policies: [makePolicy({ id: 'allow-proc', action: 'allow', target: 'process', patterns: ['*openclaw*'] })],
      });
      expect(engine.evaluateProcess('openclaw run')).toBeNull();
    });

    it('matches deny rule and returns correct policyId', () => {
      const engine = compile({
        policies: [makePolicy({ id: 'deny-proc', action: 'deny', target: 'process', patterns: ['*openclaw*'] })],
      });
      const result = engine.evaluateProcess('openclaw run');
      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(false);
      expect(result!.policyId).toBe('deny-proc');
    });

    it('returns enforcement: kill when policy has kill enforcement', () => {
      const engine = compile({
        policies: [makePolicy({ id: 'kill-proc', action: 'deny', target: 'process', patterns: ['*openclaw*'], enforcement: 'kill' })],
      });
      const result = engine.evaluateProcess('openclaw run');
      expect(result).not.toBeNull();
      expect(result!.enforcement).toBe('kill');
    });

    it('defaults enforcement to alert', () => {
      const engine = compile({
        policies: [makePolicy({ id: 'alert-proc', action: 'deny', target: 'process', patterns: ['*openclaw*'] })],
      });
      const result = engine.evaluateProcess('openclaw run');
      expect(result).not.toBeNull();
      expect(result!.enforcement).toBe('alert');
    });

    it('returns policyName in result', () => {
      const engine = compile({
        policies: [makePolicy({ id: 'named-proc', name: 'Block OpenClaw', action: 'deny', target: 'process', patterns: ['*openclaw*'] })],
      });
      const result = engine.evaluateProcess('openclaw run');
      expect(result).not.toBeNull();
      expect(result!.policyName).toBe('Block OpenClaw');
    });

    it('respects tier-based priority boost (managed > global)', () => {
      const engine = compile({
        policies: [
          makePolicy({ id: 'global-allow', action: 'deny', target: 'process', patterns: ['*openclaw*'], priority: 100, tier: undefined }),
          makePolicy({ id: 'managed-deny', action: 'deny', target: 'process', patterns: ['*openclaw*'], priority: 1, tier: 'managed' }),
        ],
      });
      const result = engine.evaluateProcess('openclaw run');
      expect(result).not.toBeNull();
      // Managed gets +10000 boost, so managed-deny should win even with lower base priority
      expect(result!.policyId).toBe('managed-deny');
    });

    it('does not cross-match URL or command target rules', () => {
      const engine = compile({
        policies: [
          makePolicy({ id: 'url-rule', action: 'deny', target: 'url', patterns: ['*openclaw*'] }),
          makePolicy({ id: 'cmd-rule', action: 'deny', target: 'command', patterns: ['*openclaw*'] }),
        ],
      });
      expect(engine.evaluateProcess('openclaw run')).toBeNull();
    });

    it('matches interpreter-aware commands (node node_modules/openclaw/...)', () => {
      const engine = compile({
        policies: [makePolicy({ id: 'interp-proc', action: 'deny', target: 'process', patterns: ['openclaw'] })],
      });
      const result = engine.evaluateProcess('node node_modules/openclaw/bin/main.js --flag');
      expect(result).not.toBeNull();
      expect(result!.policyId).toBe('interp-proc');
    });

    it('applies scope filtering with explicit context', () => {
      const engine = compile({
        policies: [makePolicy({ id: 'scoped-proc', action: 'deny', target: 'process', patterns: ['*openclaw*'], scope: 'skill' })],
      });
      // Without matching scope context, should not match
      const result = engine.evaluateProcess('openclaw run', { callerType: 'agent', depth: 0 });
      expect(result).toBeNull();
    });
  });

  describe('context forwarding', () => {
    it('returns executionContext on match', () => {
      const ctx = { callerType: 'agent' as const, depth: 1 };
      const result = compileAndEvaluate(
        [makePolicy({ id: 'p', action: 'allow', target: 'url', patterns: ['example.com'] })],
        { operation: 'http_request', target: 'https://example.com', context: ctx },
      );
      expect(result.executionContext).toEqual(ctx);
    });

    it('returns executionContext on default action (no match)', () => {
      const ctx = { callerType: 'agent' as const, depth: 0 };
      const result = compileAndEvaluate(
        [],
        { operation: 'http_request', target: 'https://example.com', context: ctx },
      );
      expect(result.executionContext).toEqual(ctx);
    });
  });
});
