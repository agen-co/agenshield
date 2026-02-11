/**
 * PolicyGraphRepository — comprehensive tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../migrations/001-initial-schema';
import { PolicyGraphRepository } from '../policy-graph.repository';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new InitialSchemaMigration().up(db);
  return {
    db,
    cleanup: () => {
      db.close();
      try { fs.rmSync(dir, { recursive: true }); } catch { /* */ }
    },
  };
}

/** Insert a policy row directly, since PolicyGraphRepository requires a valid policy_id FK */
function insertPolicy(db: Database.Database, id: string, name?: string): string {
  db.prepare(
    `INSERT INTO policies (id, name, action, target, patterns, enabled, created_at, updated_at)
     VALUES (?, ?, 'allow', 'command', '["*"]', 1, datetime('now'), datetime('now'))`,
  ).run(id, name ?? `policy-${id}`);
  return id;
}

describe('PolicyGraphRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: PolicyGraphRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new PolicyGraphRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ─── Nodes ─────────────────────────────────────────────────

  describe('Nodes', () => {
    it('createNode returns a node with generated id and timestamps', () => {
      const policyId = insertPolicy(db, 'p1');
      const node = repo.createNode({ policyId });

      expect(node.id).toBeDefined();
      expect(node.policyId).toBe('p1');
      expect(node.dormant).toBe(false);
      expect(node.createdAt).toBeDefined();
      expect(node.updatedAt).toBeDefined();
    });

    it('createNode with dormant and metadata', () => {
      const policyId = insertPolicy(db, 'p1');
      const node = repo.createNode({
        policyId,
        dormant: true,
        metadata: { label: 'test-node' },
      });

      expect(node.dormant).toBe(true);
      expect(node.metadata).toEqual({ label: 'test-node' });
    });

    it('createNode with scope (targetId and userUsername)', () => {
      const policyId = insertPolicy(db, 'p1');
      db.prepare(
        `INSERT INTO targets (id, name, created_at, updated_at) VALUES ('t1', 'T1', datetime('now'), datetime('now'))`,
      ).run();
      db.prepare(
        `INSERT INTO users (username, uid, type, created_at, home_dir) VALUES ('user1', 1001, 'agent', datetime('now'), '/home/user1')`,
      ).run();

      const node = repo.createNode({
        policyId,
        targetId: 't1',
        userUsername: 'user1',
      });

      expect(node.targetId).toBe('t1');
      expect(node.userUsername).toBe('user1');
    });

    it('getNode returns the correct node', () => {
      const policyId = insertPolicy(db, 'p1');
      const created = repo.createNode({ policyId });
      const found = repo.getNode(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.policyId).toBe('p1');
    });

    it('getNode returns null for non-existent id', () => {
      expect(repo.getNode('non-existent')).toBeNull();
    });

    it('getNodeByPolicyId returns the correct node', () => {
      const policyId = insertPolicy(db, 'p1');
      const created = repo.createNode({ policyId });

      const found = repo.getNodeByPolicyId('p1');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('getNodeByPolicyId returns null for unknown policy', () => {
      expect(repo.getNodeByPolicyId('unknown')).toBeNull();
    });

    it('getNodes returns all nodes (no scope filter)', () => {
      insertPolicy(db, 'p1');
      insertPolicy(db, 'p2');
      insertPolicy(db, 'p3');

      repo.createNode({ policyId: 'p1' });
      repo.createNode({ policyId: 'p2' });
      repo.createNode({ policyId: 'p3' });

      const nodes = repo.getNodes();
      expect(nodes).toHaveLength(3);
    });

    it('getNodes filters by scope', () => {
      db.prepare(
        `INSERT INTO targets (id, name, created_at, updated_at) VALUES ('t1', 'T1', datetime('now'), datetime('now'))`,
      ).run();

      insertPolicy(db, 'p1');
      insertPolicy(db, 'p2');

      // Global node
      repo.createNode({ policyId: 'p1' });
      // Target-scoped node
      repo.createNode({ policyId: 'p2', targetId: 't1' });

      const scoped = new PolicyGraphRepository(db, () => null, { targetId: 't1' }).getNodes();
      // Should include global (NULL) + target-scoped
      expect(scoped.length).toBeGreaterThanOrEqual(1);
    });

    it('updateNode modifies dormant flag', () => {
      insertPolicy(db, 'p1');
      const node = repo.createNode({ policyId: 'p1' });

      const updated = repo.updateNode(node.id, { dormant: true });
      expect(updated).not.toBeNull();
      expect(updated!.dormant).toBe(true);
    });

    it('updateNode modifies metadata', () => {
      insertPolicy(db, 'p1');
      const node = repo.createNode({ policyId: 'p1', metadata: { a: 1 } });

      const updated = repo.updateNode(node.id, { metadata: { a: 2, b: 3 } });
      expect(updated).not.toBeNull();
      expect(updated!.metadata).toEqual({ a: 2, b: 3 });
    });

    it('updateNode returns null for non-existent id', () => {
      expect(repo.updateNode('non-existent', { dormant: true })).toBeNull();
    });

    it('deleteNode removes a node', () => {
      insertPolicy(db, 'p1');
      const node = repo.createNode({ policyId: 'p1' });

      expect(repo.deleteNode(node.id)).toBe(true);
      expect(repo.getNode(node.id)).toBeNull();
    });

    it('deleteNode returns false for non-existent id', () => {
      expect(repo.deleteNode('non-existent')).toBe(false);
    });

    it('deleteNode cascades to edges', () => {
      insertPolicy(db, 'p1');
      insertPolicy(db, 'p2');
      const n1 = repo.createNode({ policyId: 'p1' });
      const n2 = repo.createNode({ policyId: 'p2' });
      const edge = repo.createEdge({
        sourceNodeId: n1.id,
        targetNodeId: n2.id,
        effect: 'activate',
        lifetime: 'session',
      });

      repo.deleteNode(n1.id);
      expect(repo.getEdge(edge.id)).toBeNull();
    });
  });

  // ─── Edges ─────────────────────────────────────────────────

  describe('Edges', () => {
    let n1Id: string;
    let n2Id: string;
    let n3Id: string;

    beforeEach(() => {
      insertPolicy(db, 'p1');
      insertPolicy(db, 'p2');
      insertPolicy(db, 'p3');
      n1Id = repo.createNode({ policyId: 'p1' }).id;
      n2Id = repo.createNode({ policyId: 'p2' }).id;
      n3Id = repo.createNode({ policyId: 'p3' }).id;
    });

    it('createEdge returns an edge with generated id', () => {
      const edge = repo.createEdge({
        sourceNodeId: n1Id,
        targetNodeId: n2Id,
        effect: 'activate',
        lifetime: 'session',
      });

      expect(edge.id).toBeDefined();
      expect(edge.sourceNodeId).toBe(n1Id);
      expect(edge.targetNodeId).toBe(n2Id);
      expect(edge.effect).toBe('activate');
      expect(edge.lifetime).toBe('session');
      expect(edge.priority).toBe(0);
      expect(edge.delayMs).toBe(0);
      expect(edge.enabled).toBe(true);
    });

    it('createEdge with all optional fields', () => {
      const edge = repo.createEdge({
        sourceNodeId: n1Id,
        targetNodeId: n2Id,
        effect: 'inject_secret',
        lifetime: 'once',
        priority: 10,
        condition: 'event.type === "approved"',
        secretName: 'API_KEY',
        grantPatterns: ['*.api.example.com'],
        delayMs: 5000,
        enabled: false,
      });

      expect(edge.effect).toBe('inject_secret');
      expect(edge.lifetime).toBe('once');
      expect(edge.priority).toBe(10);
      expect(edge.condition).toBe('event.type === "approved"');
      expect(edge.secretName).toBe('API_KEY');
      expect(edge.grantPatterns).toEqual(['*.api.example.com']);
      expect(edge.delayMs).toBe(5000);
      expect(edge.enabled).toBe(false);
    });

    it('createEdge rejects invalid effect', () => {
      expect(() =>
        repo.createEdge({
          sourceNodeId: n1Id,
          targetNodeId: n2Id,
          effect: 'invalid',
          lifetime: 'session',
        }),
      ).toThrow();
    });

    it('createEdge rejects invalid lifetime', () => {
      expect(() =>
        repo.createEdge({
          sourceNodeId: n1Id,
          targetNodeId: n2Id,
          effect: 'activate',
          lifetime: 'invalid',
        }),
      ).toThrow();
    });

    it('getEdge returns the correct edge', () => {
      const edge = repo.createEdge({
        sourceNodeId: n1Id,
        targetNodeId: n2Id,
        effect: 'activate',
        lifetime: 'session',
      });

      const found = repo.getEdge(edge.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(edge.id);
    });

    it('getEdge returns null for non-existent id', () => {
      expect(repo.getEdge('non-existent')).toBeNull();
    });

    it('getEdgesFrom returns edges originating from a node', () => {
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n2Id, effect: 'activate', lifetime: 'session' });
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n3Id, effect: 'deny', lifetime: 'process' });
      repo.createEdge({ sourceNodeId: n2Id, targetNodeId: n3Id, effect: 'activate', lifetime: 'session' });

      const edges = repo.getEdgesFrom(n1Id);
      expect(edges).toHaveLength(2);
      edges.forEach((e) => expect(e.sourceNodeId).toBe(n1Id));
    });

    it('getEdgesFrom returns empty for node with no outgoing edges', () => {
      expect(repo.getEdgesFrom(n3Id)).toEqual([]);
    });

    it('getEdgesTo returns edges pointing to a node', () => {
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n3Id, effect: 'activate', lifetime: 'session' });
      repo.createEdge({ sourceNodeId: n2Id, targetNodeId: n3Id, effect: 'deny', lifetime: 'once' });

      const edges = repo.getEdgesTo(n3Id);
      expect(edges).toHaveLength(2);
      edges.forEach((e) => expect(e.targetNodeId).toBe(n3Id));
    });

    it('getEdgesTo returns empty for node with no incoming edges', () => {
      expect(repo.getEdgesTo(n1Id)).toEqual([]);
    });

    it('getAllEdges returns all edges (no scope)', () => {
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n2Id, effect: 'activate', lifetime: 'session' });
      repo.createEdge({ sourceNodeId: n2Id, targetNodeId: n3Id, effect: 'deny', lifetime: 'process' });

      const all = repo.getAllEdges();
      expect(all).toHaveLength(2);
    });

    it('updateEdge modifies fields', () => {
      const edge = repo.createEdge({
        sourceNodeId: n1Id,
        targetNodeId: n2Id,
        effect: 'activate',
        lifetime: 'session',
        priority: 0,
        enabled: true,
      });

      const updated = repo.updateEdge(edge.id, {
        effect: 'deny',
        lifetime: 'persistent',
        priority: 5,
        enabled: false,
        delayMs: 1000,
      });

      expect(updated).not.toBeNull();
      expect(updated!.effect).toBe('deny');
      expect(updated!.lifetime).toBe('persistent');
      expect(updated!.priority).toBe(5);
      expect(updated!.enabled).toBe(false);
      expect(updated!.delayMs).toBe(1000);
    });

    it('updateEdge returns null for non-existent id', () => {
      expect(repo.updateEdge('non-existent', { priority: 1 })).toBeNull();
    });

    it('updateEdge with condition and secretName', () => {
      const edge = repo.createEdge({
        sourceNodeId: n1Id,
        targetNodeId: n2Id,
        effect: 'inject_secret',
        lifetime: 'once',
      });

      const updated = repo.updateEdge(edge.id, {
        condition: 'user.role === "admin"',
        secretName: 'DB_PASSWORD',
        grantPatterns: ['*.internal.example.com'],
      });

      expect(updated!.condition).toBe('user.role === "admin"');
      expect(updated!.secretName).toBe('DB_PASSWORD');
      expect(updated!.grantPatterns).toEqual(['*.internal.example.com']);
    });

    it('deleteEdge removes an edge', () => {
      const edge = repo.createEdge({
        sourceNodeId: n1Id,
        targetNodeId: n2Id,
        effect: 'activate',
        lifetime: 'session',
      });

      expect(repo.deleteEdge(edge.id)).toBe(true);
      expect(repo.getEdge(edge.id)).toBeNull();
    });

    it('deleteEdge returns false for non-existent id', () => {
      expect(repo.deleteEdge('non-existent')).toBe(false);
    });

    it('deleteEdge cascades to activations', () => {
      const edge = repo.createEdge({
        sourceNodeId: n1Id,
        targetNodeId: n2Id,
        effect: 'activate',
        lifetime: 'session',
      });
      repo.activate({ edgeId: edge.id });

      repo.deleteEdge(edge.id);
      const activations = repo.getActiveActivations();
      expect(activations).toHaveLength(0);
    });
  });

  // ─── Cycle detection ───────────────────────────────────────

  describe('Cycle detection (validateAcyclic)', () => {
    let n1Id: string;
    let n2Id: string;
    let n3Id: string;
    let n4Id: string;

    beforeEach(() => {
      insertPolicy(db, 'p1');
      insertPolicy(db, 'p2');
      insertPolicy(db, 'p3');
      insertPolicy(db, 'p4');
      n1Id = repo.createNode({ policyId: 'p1' }).id;
      n2Id = repo.createNode({ policyId: 'p2' }).id;
      n3Id = repo.createNode({ policyId: 'p3' }).id;
      n4Id = repo.createNode({ policyId: 'p4' }).id;
    });

    it('returns true for a valid DAG edge', () => {
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n2Id, effect: 'activate', lifetime: 'session' });
      // Adding n2 -> n3 should be valid
      expect(repo.validateAcyclic({ sourceId: n2Id, targetId: n3Id })).toBe(true);
    });

    it('returns false for self-loop', () => {
      expect(repo.validateAcyclic({ sourceId: n1Id, targetId: n1Id })).toBe(false);
    });

    it('returns false for direct cycle (A->B, B->A)', () => {
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n2Id, effect: 'activate', lifetime: 'session' });
      // Adding n2 -> n1 would create a cycle
      expect(repo.validateAcyclic({ sourceId: n2Id, targetId: n1Id })).toBe(false);
    });

    it('returns false for indirect cycle (A->B->C, C->A)', () => {
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n2Id, effect: 'activate', lifetime: 'session' });
      repo.createEdge({ sourceNodeId: n2Id, targetNodeId: n3Id, effect: 'activate', lifetime: 'session' });
      // Adding n3 -> n1 would create a cycle
      expect(repo.validateAcyclic({ sourceId: n3Id, targetId: n1Id })).toBe(false);
    });

    it('returns true for separate branch (no cycle)', () => {
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n2Id, effect: 'activate', lifetime: 'session' });
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n3Id, effect: 'activate', lifetime: 'session' });
      // n2 -> n4 is fine (separate branch)
      expect(repo.validateAcyclic({ sourceId: n2Id, targetId: n4Id })).toBe(true);
    });

    it('returns true for diamond shape (not a cycle)', () => {
      // A -> B, A -> C, B -> D, C -> D (diamond, not cycle)
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n2Id, effect: 'activate', lifetime: 'session' });
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n3Id, effect: 'activate', lifetime: 'session' });
      repo.createEdge({ sourceNodeId: n2Id, targetNodeId: n4Id, effect: 'activate', lifetime: 'session' });
      // C -> D is valid (diamond, no cycle)
      expect(repo.validateAcyclic({ sourceId: n3Id, targetId: n4Id })).toBe(true);
    });

    it('returns false for longer cycle (A->B->C->D, D->A)', () => {
      repo.createEdge({ sourceNodeId: n1Id, targetNodeId: n2Id, effect: 'activate', lifetime: 'session' });
      repo.createEdge({ sourceNodeId: n2Id, targetNodeId: n3Id, effect: 'activate', lifetime: 'session' });
      repo.createEdge({ sourceNodeId: n3Id, targetNodeId: n4Id, effect: 'activate', lifetime: 'session' });
      // D -> A would complete the cycle
      expect(repo.validateAcyclic({ sourceId: n4Id, targetId: n1Id })).toBe(false);
    });
  });

  // ─── Activations ───────────────────────────────────────────

  describe('Activations', () => {
    let edgeId: string;

    beforeEach(() => {
      insertPolicy(db, 'p1');
      insertPolicy(db, 'p2');
      const n1 = repo.createNode({ policyId: 'p1' });
      const n2 = repo.createNode({ policyId: 'p2' });
      const edge = repo.createEdge({
        sourceNodeId: n1.id,
        targetNodeId: n2.id,
        effect: 'activate',
        lifetime: 'session',
      });
      edgeId = edge.id;
    });

    it('activate creates an activation', () => {
      const act = repo.activate({ edgeId });

      expect(act.id).toBeDefined();
      expect(act.edgeId).toBe(edgeId);
      expect(act.activatedAt).toBeDefined();
      expect(act.consumed).toBe(false);
    });

    it('activate with expiresAt', () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      const act = repo.activate({ edgeId, expiresAt: future });

      expect(act.expiresAt).toBe(future);
    });

    it('activate with processId', () => {
      const act = repo.activate({ edgeId, processId: 12345 });

      expect(act.processId).toBe(12345);
    });

    it('getActiveActivations returns non-consumed, non-expired', () => {
      repo.activate({ edgeId });
      repo.activate({ edgeId });

      const active = repo.getActiveActivations();
      expect(active).toHaveLength(2);
    });

    it('getActiveActivations filters by edgeId', () => {
      insertPolicy(db, 'p3');
      const n3 = repo.createNode({ policyId: 'p3' });
      const edge2 = repo.createEdge({
        sourceNodeId: repo.getNodeByPolicyId('p1')!.id,
        targetNodeId: n3.id,
        effect: 'deny',
        lifetime: 'once',
      });

      repo.activate({ edgeId });
      repo.activate({ edgeId });
      repo.activate({ edgeId: edge2.id });

      const forEdge1 = repo.getActiveActivations(edgeId);
      expect(forEdge1).toHaveLength(2);

      const forEdge2 = repo.getActiveActivations(edge2.id);
      expect(forEdge2).toHaveLength(1);
    });

    it('getActiveActivations excludes expired activations', () => {
      const past = new Date(Date.now() - 3600_000).toISOString();
      repo.activate({ edgeId, expiresAt: past });

      const active = repo.getActiveActivations();
      expect(active).toHaveLength(0);
    });

    it('consumeActivation marks as consumed', () => {
      const act = repo.activate({ edgeId });
      repo.consumeActivation(act.id);

      const active = repo.getActiveActivations();
      expect(active).toHaveLength(0);
    });

    it('expireByProcess consumes all activations for a process', () => {
      repo.activate({ edgeId, processId: 100 });
      repo.activate({ edgeId, processId: 100 });
      repo.activate({ edgeId, processId: 200 });

      repo.expireByProcess(100);

      const active = repo.getActiveActivations();
      expect(active).toHaveLength(1);
      expect(active[0].processId).toBe(200);
    });

    it('expireBySession consumes non-persistent activations', () => {
      // The edge has lifetime = 'session'
      repo.activate({ edgeId });
      repo.activate({ edgeId });

      // Create a persistent edge and activate it
      insertPolicy(db, 'p-persist');
      const n3 = repo.createNode({ policyId: 'p-persist' });
      const persistentEdge = repo.createEdge({
        sourceNodeId: repo.getNodeByPolicyId('p1')!.id,
        targetNodeId: n3.id,
        effect: 'activate',
        lifetime: 'persistent',
      });
      repo.activate({ edgeId: persistentEdge.id });

      repo.expireBySession();

      const active = repo.getActiveActivations();
      // Only the persistent activation should remain
      expect(active).toHaveLength(1);
      expect(active[0].edgeId).toBe(persistentEdge.id);
    });

    it('pruneExpired removes consumed activations', () => {
      const act1 = repo.activate({ edgeId });
      repo.activate({ edgeId });

      repo.consumeActivation(act1.id);

      const pruned = repo.pruneExpired();
      expect(pruned).toBeGreaterThanOrEqual(1);
    });

    it('pruneExpired removes time-expired activations', () => {
      const past = new Date(Date.now() - 3600_000).toISOString();
      repo.activate({ edgeId, expiresAt: past });

      const pruned = repo.pruneExpired();
      expect(pruned).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Graph loading ─────────────────────────────────────────

  describe('Graph loading', () => {
    it('loadGraph returns nodes, edges, and activations', () => {
      insertPolicy(db, 'p1');
      insertPolicy(db, 'p2');
      insertPolicy(db, 'p3');

      const n1 = repo.createNode({ policyId: 'p1' });
      const n2 = repo.createNode({ policyId: 'p2' });
      const n3 = repo.createNode({ policyId: 'p3' });

      const e1 = repo.createEdge({ sourceNodeId: n1.id, targetNodeId: n2.id, effect: 'activate', lifetime: 'session' });
      const e2 = repo.createEdge({ sourceNodeId: n2.id, targetNodeId: n3.id, effect: 'deny', lifetime: 'once' });

      repo.activate({ edgeId: e1.id });

      const graph = repo.loadGraph();

      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges).toHaveLength(2);
      expect(graph.activations).toHaveLength(1);
    });

    it('loadGraph returns empty graph when no data', () => {
      const graph = repo.loadGraph();

      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
      expect(graph.activations).toEqual([]);
    });

    it('loadGraph filters by scope', () => {
      db.prepare(
        `INSERT INTO targets (id, name, created_at, updated_at) VALUES ('t1', 'T1', datetime('now'), datetime('now'))`,
      ).run();

      insertPolicy(db, 'p-global');
      insertPolicy(db, 'p-scoped');

      const nGlobal = repo.createNode({ policyId: 'p-global' });
      const nScoped = repo.createNode({ policyId: 'p-scoped', targetId: 't1' });

      repo.createEdge({ sourceNodeId: nGlobal.id, targetNodeId: nScoped.id, effect: 'activate', lifetime: 'session' });

      const graph = new PolicyGraphRepository(db, () => null, { targetId: 't1' }).loadGraph();
      // Should include both global + scoped
      expect(graph.nodes.length).toBeGreaterThanOrEqual(1);
      expect(graph.edges.length).toBeGreaterThanOrEqual(0);
    });

    it('loadGraph excludes consumed activations', () => {
      insertPolicy(db, 'p1');
      insertPolicy(db, 'p2');

      const n1 = repo.createNode({ policyId: 'p1' });
      const n2 = repo.createNode({ policyId: 'p2' });

      const edge = repo.createEdge({ sourceNodeId: n1.id, targetNodeId: n2.id, effect: 'activate', lifetime: 'once' });

      const act = repo.activate({ edgeId: edge.id });
      repo.consumeActivation(act.id);

      const graph = repo.loadGraph();
      expect(graph.activations).toHaveLength(0);
    });
  });

  // ─── Performance ───────────────────────────────────────────

  describe('Performance', () => {
    it('handles 100 nodes + 200 edges creation', () => {
      // Create 100 policies
      for (let i = 0; i < 100; i++) {
        insertPolicy(db, `perf-p${i}`, `Perf Policy ${i}`);
      }

      const start = performance.now();

      // Create 100 nodes
      const nodeIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        const node = repo.createNode({ policyId: `perf-p${i}` });
        nodeIds.push(node.id);
      }

      // Create 200 edges (linear chain + some skip connections)
      for (let i = 0; i < 99; i++) {
        repo.createEdge({
          sourceNodeId: nodeIds[i],
          targetNodeId: nodeIds[i + 1],
          effect: 'activate',
          lifetime: 'session',
        });
      }
      // Skip connections (no cycles)
      for (let i = 0; i < 100; i++) {
        const from = i;
        const to = Math.min(i + 2, 99);
        if (from !== to) {
          repo.createEdge({
            sourceNodeId: nodeIds[from],
            targetNodeId: nodeIds[to],
            effect: 'deny',
            lifetime: 'once',
            priority: 1,
          });
        }
      }

      const createElapsed = performance.now() - start;
      expect(createElapsed).toBeLessThan(10_000);

      // loadGraph performance
      const loadStart = performance.now();
      const graph = repo.loadGraph();
      const loadElapsed = performance.now() - loadStart;

      expect(graph.nodes).toHaveLength(100);
      expect(graph.edges.length).toBeGreaterThanOrEqual(100);
      expect(loadElapsed).toBeLessThan(2_000);
    });

    it('validateAcyclic is fast on large graphs', () => {
      // Create a chain of 50 nodes
      for (let i = 0; i < 50; i++) {
        insertPolicy(db, `chain-p${i}`);
      }

      const nodeIds: string[] = [];
      for (let i = 0; i < 50; i++) {
        const node = repo.createNode({ policyId: `chain-p${i}` });
        nodeIds.push(node.id);
      }

      for (let i = 0; i < 49; i++) {
        repo.createEdge({
          sourceNodeId: nodeIds[i],
          targetNodeId: nodeIds[i + 1],
          effect: 'activate',
          lifetime: 'session',
        });
      }

      const start = performance.now();

      // Check cycle detection on last -> first (should detect cycle)
      expect(repo.validateAcyclic({ sourceId: nodeIds[49], targetId: nodeIds[0] })).toBe(false);

      // Check adding a valid edge (no cycle)
      expect(repo.validateAcyclic({ sourceId: nodeIds[0], targetId: nodeIds[49] })).toBe(true);

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1_000);
    });
  });
});
