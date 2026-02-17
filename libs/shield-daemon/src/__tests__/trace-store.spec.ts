/**
 * TraceStore — unit tests
 *
 * Tests execution trace tracking, parent-child chain lookup,
 * shared capability computation via edge sharing config,
 * TTL pruning, and execId cleanup.
 */

import type { PolicyGraph } from '@agenshield/ipc';
import { TraceStore, type ExecutionTrace, type SharedCapabilities } from '../services/trace-store';

function makeTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    traceId: 'trace-1',
    command: 'gog deploy',
    depth: 1,
    status: 'running',
    startedAt: Date.now(),
    ...overrides,
  };
}

function makeGraph(overrides: Partial<PolicyGraph> = {}): PolicyGraph {
  return {
    nodes: [],
    edges: [],
    activations: [],
    ...overrides,
  };
}

describe('TraceStore', () => {
  let store: TraceStore;

  beforeEach(() => {
    store = new TraceStore();
  });

  // ─── Basic CRUD ────────────────────────────────────────────

  describe('create / get', () => {
    it('stores and retrieves a trace by ID', () => {
      const trace = makeTrace({ traceId: 'abc' });
      store.create(trace);

      expect(store.get('abc')).toBe(trace);
    });

    it('returns undefined for non-existent trace', () => {
      expect(store.get('missing')).toBeUndefined();
    });

    it('tracks the number of active traces', () => {
      expect(store.size).toBe(0);
      store.create(makeTrace({ traceId: 'a' }));
      store.create(makeTrace({ traceId: 'b' }));
      expect(store.size).toBe(2);
    });
  });

  // ─── Completion ────────────────────────────────────────────

  describe('complete', () => {
    it('marks a trace as completed with timestamp', () => {
      const trace = makeTrace({ traceId: 'c1' });
      store.create(trace);

      const before = Date.now();
      store.complete('c1');
      const after = Date.now();

      const completed = store.get('c1')!;
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeGreaterThanOrEqual(before);
      expect(completed.completedAt).toBeLessThanOrEqual(after);
    });

    it('is a no-op for non-existent traces', () => {
      // Should not throw
      store.complete('non-existent');
    });
  });

  // ─── Parent Chain ──────────────────────────────────────────

  describe('getByParent', () => {
    it('returns all children of a parent trace', () => {
      store.create(makeTrace({ traceId: 'parent' }));
      store.create(makeTrace({ traceId: 'child-1', parentTraceId: 'parent', command: 'git push' }));
      store.create(makeTrace({ traceId: 'child-2', parentTraceId: 'parent', command: 'curl api.com' }));
      store.create(makeTrace({ traceId: 'other', parentTraceId: 'different-parent' }));

      const children = store.getByParent('parent');

      expect(children).toHaveLength(2);
      expect(children.map(c => c.traceId).sort()).toEqual(['child-1', 'child-2']);
    });

    it('returns empty array when no children exist', () => {
      store.create(makeTrace({ traceId: 'lonely' }));

      expect(store.getByParent('lonely')).toEqual([]);
    });
  });

  // ─── Shared Capabilities ──────────────────────────────────

  describe('getSharedCapabilities', () => {
    it('returns undefined when parent trace has no graphNodeId', () => {
      store.create(makeTrace({ traceId: 'parent', graphNodeId: undefined }));

      const graph = makeGraph();
      const result = store.getSharedCapabilities('parent', 'child-node', graph);

      expect(result).toBeUndefined();
    });

    it('returns undefined when no edge from parent to child exists', () => {
      store.create(makeTrace({ traceId: 'parent', graphNodeId: 'n1' }));

      const graph = makeGraph({
        nodes: [
          { id: 'n1', policyId: 'p1', dormant: false, createdAt: '', updatedAt: '' },
          { id: 'n2', policyId: 'p2', dormant: false, createdAt: '', updatedAt: '' },
        ],
        edges: [],
      });

      const result = store.getSharedCapabilities('parent', 'n2', graph);

      expect(result).toBeUndefined();
    });

    it('returns undefined when edge exists but has no sharing config', () => {
      store.create(makeTrace({ traceId: 'parent', graphNodeId: 'n1' }));

      const graph = makeGraph({
        nodes: [
          { id: 'n1', policyId: 'p1', dormant: false, createdAt: '', updatedAt: '' },
          { id: 'n2', policyId: 'p2', dormant: false, createdAt: '', updatedAt: '' },
        ],
        edges: [{
          id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2',
          effect: 'activate', lifetime: 'session', priority: 0, enabled: true,
          createdAt: '', updatedAt: '',
        }],
      });

      const result = store.getSharedCapabilities('parent', 'n2', graph);

      expect(result).toBeUndefined();
    });

    it('returns shared capabilities from edge sharing config', () => {
      store.create(makeTrace({ traceId: 'parent', graphNodeId: 'n1' }));

      const graph = makeGraph({
        nodes: [
          { id: 'n1', policyId: 'p1', dormant: false, createdAt: '', updatedAt: '' },
          { id: 'n2', policyId: 'p2', dormant: false, createdAt: '', updatedAt: '' },
        ],
        edges: [{
          id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2',
          effect: 'activate', lifetime: 'session', priority: 0, enabled: true,
          sharing: {
            shareSecrets: ['WORKSPACE', 'API_KEY'],
            shareNetwork: ['*.internal.com', 'api.example.com'],
            shareFs: { read: ['/data/shared'], write: ['/tmp/output'] },
          },
          createdAt: '', updatedAt: '',
        }],
      });

      const result = store.getSharedCapabilities('parent', 'n2', graph);

      expect(result).toEqual({
        networkPatterns: ['*.internal.com', 'api.example.com'],
        fsPaths: { read: ['/data/shared'], write: ['/tmp/output'] },
        secretNames: ['WORKSPACE', 'API_KEY'],
      } satisfies SharedCapabilities);
    });

    it('returns empty arrays for partial sharing config', () => {
      store.create(makeTrace({ traceId: 'parent', graphNodeId: 'n1' }));

      const graph = makeGraph({
        nodes: [
          { id: 'n1', policyId: 'p1', dormant: false, createdAt: '', updatedAt: '' },
          { id: 'n2', policyId: 'p2', dormant: false, createdAt: '', updatedAt: '' },
        ],
        edges: [{
          id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2',
          effect: 'activate', lifetime: 'session', priority: 0, enabled: true,
          sharing: { shareSecrets: ['TOKEN'] },
          createdAt: '', updatedAt: '',
        }],
      });

      const result = store.getSharedCapabilities('parent', 'n2', graph);

      expect(result).toEqual({
        networkPatterns: [],
        fsPaths: { read: [], write: [] },
        secretNames: ['TOKEN'],
      });
    });

    it('ignores disabled edges', () => {
      store.create(makeTrace({ traceId: 'parent', graphNodeId: 'n1' }));

      const graph = makeGraph({
        nodes: [
          { id: 'n1', policyId: 'p1', dormant: false, createdAt: '', updatedAt: '' },
          { id: 'n2', policyId: 'p2', dormant: false, createdAt: '', updatedAt: '' },
        ],
        edges: [{
          id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2',
          effect: 'activate', lifetime: 'session', priority: 0,
          enabled: false,
          sharing: { shareSecrets: ['SHOULD_NOT_APPEAR'] },
          createdAt: '', updatedAt: '',
        }],
      });

      const result = store.getSharedCapabilities('parent', 'n2', graph);

      expect(result).toBeUndefined();
    });

    it('returns undefined when parent trace does not exist', () => {
      const graph = makeGraph();
      expect(store.getSharedCapabilities('non-existent', 'n1', graph)).toBeUndefined();
    });
  });

  // ─── Pruning ───────────────────────────────────────────────

  describe('prune', () => {
    it('removes traces older than maxAgeMs', () => {
      const now = Date.now();
      store.create(makeTrace({ traceId: 'old', startedAt: now - 60_000 }));
      store.create(makeTrace({ traceId: 'new', startedAt: now - 1_000 }));

      store.prune(30_000); // 30 seconds

      expect(store.get('old')).toBeUndefined();
      expect(store.get('new')).toBeDefined();
      expect(store.size).toBe(1);
    });

    it('is a no-op when no traces are old enough', () => {
      const now = Date.now();
      store.create(makeTrace({ traceId: 'a', startedAt: now }));
      store.create(makeTrace({ traceId: 'b', startedAt: now }));

      store.prune(60_000);

      expect(store.size).toBe(2);
    });

    it('removes all traces when all are old enough', () => {
      const now = Date.now();
      store.create(makeTrace({ traceId: 'a', startedAt: now - 100_000 }));
      store.create(makeTrace({ traceId: 'b', startedAt: now - 200_000 }));

      store.prune(10_000);

      expect(store.size).toBe(0);
    });
  });

  // ─── removeByExecId ────────────────────────────────────────

  describe('removeByExecId', () => {
    it('removes trace with matching execId', () => {
      store.create(makeTrace({ traceId: 't1', execId: 'exec-abc' }));
      store.create(makeTrace({ traceId: 't2', execId: 'exec-def' }));

      store.removeByExecId('exec-abc');

      expect(store.get('t1')).toBeUndefined();
      expect(store.get('t2')).toBeDefined();
    });

    it('is a no-op when no trace matches', () => {
      store.create(makeTrace({ traceId: 't1', execId: 'exec-abc' }));

      store.removeByExecId('exec-missing');

      expect(store.size).toBe(1);
    });

    it('only removes the first matching trace', () => {
      store.create(makeTrace({ traceId: 't1', execId: 'exec-same' }));
      store.create(makeTrace({ traceId: 't2', execId: 'exec-same' }));

      store.removeByExecId('exec-same');

      // Should remove only one (first found)
      expect(store.size).toBe(1);
    });
  });
});
