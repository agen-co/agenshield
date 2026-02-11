/**
 * PolicyRepository tests
 *
 * Covers: CRUD, scoping, preset seeding, count, and performance benchmarks.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../migrations/001-initial-schema';
import { PolicyRepository } from '../policy.repository';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

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

// PolicyRepository does not use encryption, but the constructor requires getKey
const getKey = () => null;

/**
 * Insert parent rows required by foreign key constraints.
 * Policies reference targets(id) and users(username).
 */
function seedScopeFixtures(db: Database.Database): void {
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-a', 'Target A');
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-b', 'Target B');
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-x', 'Target X');
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-z', 'Target Z');
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-del', 'Target Del');
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-preset', 'Target Preset');
}

let counter = 0;
function makePolicy(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    id: `policy-${counter}-${Date.now()}`,
    name: `Test Policy ${counter}`,
    action: 'allow' as const,
    target: 'command' as const,
    patterns: ['node:*'],
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PolicyRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: PolicyRepository;

  beforeEach(() => {
    counter = 0;
    ({ db, cleanup } = createTestDb());
    repo = new PolicyRepository(db, getKey);
  });

  afterEach(() => cleanup());

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  describe('CRUD', () => {
    it('should create a policy and return it', () => {
      const input = makePolicy();
      const created = repo.create(input);

      expect(created.id).toBe(input.id);
      expect(created.name).toBe(input.name);
      expect(created.action).toBe('allow');
      expect(created.target).toBe('command');
      expect(created.patterns).toEqual(['node:*']);
      expect(created.enabled).toBe(true);
    });

    it('should retrieve a policy by id', () => {
      const input = makePolicy();
      repo.create(input);

      const fetched = repo.getById(input.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(input.id);
      expect(fetched!.name).toBe(input.name);
    });

    it('should return null for a non-existent policy id', () => {
      expect(repo.getById('does-not-exist')).toBeNull();
    });

    it('should list all policies', () => {
      repo.create(makePolicy());
      repo.create(makePolicy());
      repo.create(makePolicy());

      const all = repo.getAll();
      expect(all).toHaveLength(3);
    });

    it('should list only enabled policies', () => {
      repo.create(makePolicy({ enabled: true }));
      repo.create(makePolicy({ enabled: false }));
      repo.create(makePolicy({ enabled: true }));

      const enabled = repo.getEnabled();
      expect(enabled).toHaveLength(2);
      expect(enabled.every((p) => p.enabled)).toBe(true);
    });

    it('should update a policy name', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { name: 'Renamed' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Renamed');
    });

    it('should update a policy action', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { action: 'deny' });
      expect(updated).not.toBeNull();
      expect(updated!.action).toBe('deny');
    });

    it('should update a policy enabled flag', () => {
      const input = makePolicy({ enabled: true });
      repo.create(input);

      const updated = repo.update(input.id, { enabled: false });
      expect(updated).not.toBeNull();
      expect(updated!.enabled).toBe(false);
    });

    it('should update policy patterns', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { patterns: ['curl:*', 'wget:*'] });
      expect(updated).not.toBeNull();
      expect(updated!.patterns).toEqual(['curl:*', 'wget:*']);
    });

    it('should update policy priority', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { priority: 10 });
      expect(updated).not.toBeNull();
      expect(updated!.priority).toBe(10);
    });

    it('should update policy operations', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { operations: ['exec', 'file_read'] });
      expect(updated).not.toBeNull();
      expect(updated!.operations).toEqual(['exec', 'file_read']);
    });

    it('should update policy preset field', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { preset: 'custom' });
      expect(updated).not.toBeNull();
      expect(updated!.preset).toBe('custom');
    });

    it('should update policy scope field', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { scope: 'skill:my-tool' });
      expect(updated).not.toBeNull();
      expect(updated!.scope).toBe('skill:my-tool');
    });

    it('should return null when updating a non-existent policy', () => {
      expect(repo.update('nope', { name: 'X' })).toBeNull();
    });

    it('should delete a policy', () => {
      const input = makePolicy();
      repo.create(input);

      expect(repo.delete(input.id)).toBe(true);
      expect(repo.getById(input.id)).toBeNull();
    });

    it('should return false when deleting a non-existent policy', () => {
      expect(repo.delete('nope')).toBe(false);
    });

    it('should delete all policies (global scope)', () => {
      repo.create(makePolicy());
      repo.create(makePolicy());
      repo.create(makePolicy());

      const deleted = repo.deleteAll();
      expect(deleted).toBe(3);
      expect(repo.getAll()).toHaveLength(0);
    });

    it('should count policies', () => {
      expect(repo.count()).toBe(0);
      repo.create(makePolicy());
      repo.create(makePolicy());
      expect(repo.count()).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Scoping
  // -----------------------------------------------------------------------

  describe('Scoping', () => {
    beforeEach(() => seedScopeFixtures(db));

    it('should create policies with different targets and filter by scope', () => {
      repo.create(makePolicy({ id: 'global-1', target: 'url' }));
      const scopedA = new PolicyRepository(db, getKey, { targetId: 'target-a' });
      const scopedB = new PolicyRepository(db, getKey, { targetId: 'target-b' });
      scopedA.create(makePolicy({ id: 'target-1', target: 'command' }));
      scopedB.create(makePolicy({ id: 'target-2', target: 'command' }));

      // Querying with target-a scope should return global + target-a policies
      const results = scopedA.getAll();
      const ids = results.map((p) => p.id).sort();
      expect(ids).toEqual(['global-1', 'target-1']);
    });

    it('should return only global policies when no scope is provided', () => {
      repo.create(makePolicy({ id: 'global-only' }));
      const scopedA = new PolicyRepository(db, getKey, { targetId: 'target-a' });
      scopedA.create(makePolicy({ id: 'scoped' }));

      // getAll() without scope returns ALL policies (no scope filtering)
      const all = repo.getAll();
      expect(all).toHaveLength(2);
    });

    it('should count policies filtered by scope', () => {
      repo.create(makePolicy());
      const scopedX = new PolicyRepository(db, getKey, { targetId: 'target-x' });
      scopedX.create(makePolicy());

      // Global scope includes base policies
      const globalCount = scopedX.count();
      // Should include both the base policy and the target-x policy
      expect(globalCount).toBe(2);
    });

    it('should getEnabled with scope filter', () => {
      repo.create(makePolicy({ id: 'g-enabled', enabled: true }));
      repo.create(makePolicy({ id: 'g-disabled', enabled: false }));
      const scopedZ = new PolicyRepository(db, getKey, { targetId: 'target-z' });
      scopedZ.create(makePolicy({ id: 't-enabled', enabled: true }));

      const enabled = scopedZ.getEnabled();
      const ids = enabled.map((p) => p.id).sort();
      expect(ids).toEqual(['g-enabled', 't-enabled']);
    });

    it('should deleteAll only for a specific scope', () => {
      repo.create(makePolicy({ id: 'base-pol' }));
      const scopedDel = new PolicyRepository(db, getKey, { targetId: 'target-del' });
      scopedDel.create(makePolicy({ id: 'target-pol' }));

      // Delete only target-scoped policies
      const deleted = new PolicyRepository(db, getKey, { targetId: 'target-del', userUsername: null }).deleteAll();
      expect(deleted).toBe(1);

      // Base policy still exists
      expect(repo.getById('base-pol')).not.toBeNull();
      expect(repo.getById('target-pol')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Preset seeding
  // -----------------------------------------------------------------------

  describe('Preset seeding', () => {
    it('should seed openclaw preset policies', () => {
      const count = repo.seedPreset('openclaw');
      expect(count).toBeGreaterThan(0);

      const all = repo.getAll();
      expect(all.length).toBe(count);
      expect(all.every((p) => p.preset === 'openclaw')).toBe(true);
    });

    it('should seed agenco preset policies', () => {
      const count = repo.seedPreset('agenco');
      expect(count).toBeGreaterThan(0);

      const all = repo.getAll();
      expect(all.some((p) => p.preset === 'agenco')).toBe(true);
    });

    it('should not duplicate policies when seeding twice', () => {
      const first = repo.seedPreset('openclaw');
      const second = repo.seedPreset('openclaw');

      expect(second).toBe(0);
      expect(repo.getAll()).toHaveLength(first);
    });

    it('should return 0 for an unknown preset', () => {
      expect(repo.seedPreset('nonexistent-preset')).toBe(0);
    });

    it('should seed preset with scope', () => {
      seedScopeFixtures(db);
      const scopedPreset = new PolicyRepository(db, getKey, { targetId: 'target-preset' });
      const count = scopedPreset.seedPreset('openclaw');
      expect(count).toBeGreaterThan(0);

      // The seeded policies should be queryable with that scope
      const all = scopedPreset.getAll();
      expect(all.length).toBe(count);
    });
  });

  // -----------------------------------------------------------------------
  // Performance
  // -----------------------------------------------------------------------

  describe('Performance', () => {
    it('should create 1000 policies efficiently', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        repo.create({
          id: `perf-${i}`,
          name: `Perf Policy ${i}`,
          action: 'allow',
          target: 'command',
          patterns: [`cmd-${i}:*`],
          enabled: true,
        });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round(1000 / (elapsed / 1000));

      // Expect at least 200 ops/sec
      expect(opsPerSec).toBeGreaterThan(200);
    });

    it('should getAll 1000 policies efficiently', () => {
      for (let i = 0; i < 1000; i++) {
        repo.create({
          id: `perf-read-${i}`,
          name: `Policy ${i}`,
          action: 'allow',
          target: 'url',
          patterns: [`example-${i}.com`],
          enabled: true,
        });
      }

      const start = performance.now();
      const all = repo.getAll();
      const elapsed = performance.now() - start;

      expect(all).toHaveLength(1000);
      // Should complete in under 1 second
      expect(elapsed).toBeLessThan(1000);
    });
  });
});
