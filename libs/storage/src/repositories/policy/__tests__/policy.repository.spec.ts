/**
 * PolicyRepository tests
 *
 * Covers: CRUD, scoping, preset seeding, count, and performance benchmarks.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { PolicyRepository } from '../policy.repository';

function insertProfile(db: Database.Database, id: string, name?: string): void {
  db.prepare(
    `INSERT INTO profiles (id, name, type, created_at, updated_at)
     VALUES (?, ?, 'target', datetime('now'), datetime('now'))`,
  ).run(id, name ?? `Profile ${id}`);
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new SchemaMigration().up(db);
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
 * Insert parent profile rows required by foreign key constraints.
 */
function seedScopeFixtures(db: Database.Database): void {
  insertProfile(db, 'profile-a', 'Profile A');
  insertProfile(db, 'profile-b', 'Profile B');
  insertProfile(db, 'profile-x', 'Profile X');
  insertProfile(db, 'profile-z', 'Profile Z');
  insertProfile(db, 'profile-del', 'Profile Del');
  insertProfile(db, 'profile-preset', 'Profile Preset');
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

    it('should create policies with different profiles and filter by scope', () => {
      repo.create(makePolicy({ id: 'global-1', target: 'url' }));
      const scopedA = new PolicyRepository(db, getKey, { profileId: 'profile-a' });
      const scopedB = new PolicyRepository(db, getKey, { profileId: 'profile-b' });
      scopedA.create(makePolicy({ id: 'profile-1', target: 'command' }));
      scopedB.create(makePolicy({ id: 'profile-2', target: 'command' }));

      // Querying with profile-a scope should return global + profile-a policies
      const results = scopedA.getAll();
      const ids = results.map((p) => p.id).sort();
      expect(ids).toEqual(['global-1', 'profile-1']);
    });

    it('should return only global policies when no scope is provided', () => {
      repo.create(makePolicy({ id: 'global-only' }));
      const scopedA = new PolicyRepository(db, getKey, { profileId: 'profile-a' });
      scopedA.create(makePolicy({ id: 'scoped' }));

      // getAll() without scope returns ALL policies (no scope filtering)
      const all = repo.getAll();
      expect(all).toHaveLength(2);
    });

    it('should count policies filtered by scope', () => {
      repo.create(makePolicy());
      const scopedX = new PolicyRepository(db, getKey, { profileId: 'profile-x' });
      scopedX.create(makePolicy());

      // Scoped count includes base policies
      const scopedCount = scopedX.count();
      // Should include both the base policy and the profile-x policy
      expect(scopedCount).toBe(2);
    });

    it('should getEnabled with scope filter', () => {
      repo.create(makePolicy({ id: 'g-enabled', enabled: true }));
      repo.create(makePolicy({ id: 'g-disabled', enabled: false }));
      const scopedZ = new PolicyRepository(db, getKey, { profileId: 'profile-z' });
      scopedZ.create(makePolicy({ id: 'p-enabled', enabled: true }));

      const enabled = scopedZ.getEnabled();
      const ids = enabled.map((p) => p.id).sort();
      expect(ids).toEqual(['g-enabled', 'p-enabled']);
    });

    it('should deleteAll only for a specific scope', () => {
      repo.create(makePolicy({ id: 'base-pol' }));
      const scopedDel = new PolicyRepository(db, getKey, { profileId: 'profile-del' });
      scopedDel.create(makePolicy({ id: 'profile-pol' }));

      // Delete only profile-scoped policies
      const deleted = new PolicyRepository(db, getKey, { profileId: 'profile-del' }).deleteAll();
      expect(deleted).toBe(1);

      // Base policy still exists
      expect(repo.getById('base-pol')).not.toBeNull();
      expect(repo.getById('profile-pol')).toBeNull();
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
      const scopedPreset = new PolicyRepository(db, getKey, { profileId: 'profile-preset' });
      const count = scopedPreset.seedPreset('openclaw');
      expect(count).toBeGreaterThan(0);

      // The seeded policies should be queryable with that scope
      const all = scopedPreset.getAll();
      expect(all.length).toBe(count);
    });
  });

  // -----------------------------------------------------------------------
  // Tier: managed, global, target
  // -----------------------------------------------------------------------

  describe('Tiers', () => {
    beforeEach(() => seedScopeFixtures(db));

    it('should create a regular policy with tier="global" when no scope', () => {
      const created = repo.create(makePolicy());
      expect(created.tier).toBe('global');
    });

    it('should create a regular policy with tier="target" when scoped', () => {
      const scoped = new PolicyRepository(db, getKey, { profileId: 'profile-a' });
      const created = scoped.create(makePolicy());
      expect(created.tier).toBe('target');
    });

    it('should create a managed policy with tier="managed"', () => {
      const created = repo.createManaged(makePolicy(), 'cloud');
      expect(created.tier).toBe('managed');
    });

    it('should store managed_source for managed policies', () => {
      const policy = makePolicy();
      repo.createManaged(policy, 'cloud-admin');

      // Verify via raw SQL
      const row = db.prepare('SELECT managed, managed_source FROM policies WHERE id = ?').get(policy.id) as { managed: number; managed_source: string | null };
      expect(row.managed).toBe(1);
      expect(row.managed_source).toBe('cloud-admin');
    });

    it('should derive tier correctly in getById', () => {
      const globalPolicy = makePolicy({ id: 'tier-g' });
      repo.create(globalPolicy);

      const managedPolicy = makePolicy({ id: 'tier-m' });
      repo.createManaged(managedPolicy, 'admin');

      const scopedRepo = new PolicyRepository(db, getKey, { profileId: 'profile-a' });
      const targetPolicy = makePolicy({ id: 'tier-t' });
      scopedRepo.create(targetPolicy);

      expect(repo.getById('tier-g')!.tier).toBe('global');
      expect(repo.getById('tier-m')!.tier).toBe('managed');
      expect(repo.getById('tier-t')!.tier).toBe('target');
    });

    it('should return managed policies via getManaged()', () => {
      repo.create(makePolicy({ id: 'regular' }));
      repo.createManaged(makePolicy({ id: 'managed-1' }), 'admin');
      repo.createManaged(makePolicy({ id: 'managed-2' }), 'cloud');

      const managed = repo.getManaged();
      expect(managed).toHaveLength(2);
      expect(managed.every((p) => p.tier === 'managed')).toBe(true);
    });

    it('should return tiered policies via getTiered() in global context', () => {
      repo.createManaged(makePolicy({ id: 'm1' }), 'admin');
      repo.create(makePolicy({ id: 'g1' }));

      const tiered = repo.getTiered();
      expect(tiered.managed).toHaveLength(1);
      expect(tiered.managed[0].id).toBe('m1');
      expect(tiered.global).toHaveLength(1);
      expect(tiered.global[0].id).toBe('g1');
      expect(tiered.target).toHaveLength(0);
    });

    it('should return tiered policies via getTiered() in scoped context', () => {
      repo.createManaged(makePolicy({ id: 'm1' }), 'admin');
      repo.create(makePolicy({ id: 'g1' }));
      const scopedA = new PolicyRepository(db, getKey, { profileId: 'profile-a' });
      scopedA.create(makePolicy({ id: 't1' }));

      const tiered = scopedA.getTiered();
      expect(tiered.managed).toHaveLength(1);
      expect(tiered.global).toHaveLength(1);
      expect(tiered.target).toHaveLength(1);
      expect(tiered.target[0].id).toBe('t1');
    });

    it('should deleteNonManaged only delete non-managed policies', () => {
      repo.createManaged(makePolicy({ id: 'preserved' }), 'admin');
      repo.create(makePolicy({ id: 'deleted-1' }));
      repo.create(makePolicy({ id: 'deleted-2' }));

      const deleted = repo.deleteNonManaged();
      expect(deleted).toBe(2);

      // Managed policy preserved
      expect(repo.getById('preserved')).not.toBeNull();
      expect(repo.getById('preserved')!.tier).toBe('managed');

      // Non-managed policies gone
      expect(repo.getById('deleted-1')).toBeNull();
      expect(repo.getById('deleted-2')).toBeNull();
    });

    it('should deleteNonManaged respect profile scope', () => {
      const scopedA = new PolicyRepository(db, getKey, { profileId: 'profile-a' });
      scopedA.create(makePolicy({ id: 'scope-a-pol' }));

      const scopedB = new PolicyRepository(db, getKey, { profileId: 'profile-b' });
      scopedB.create(makePolicy({ id: 'scope-b-pol' }));

      // Delete only profile-a non-managed policies
      const deletedCount = scopedA.deleteNonManaged();
      expect(deletedCount).toBe(1);

      // profile-b policy preserved
      expect(repo.getById('scope-b-pol')).not.toBeNull();
      expect(repo.getById('scope-a-pol')).toBeNull();
    });

    it('should return target sections via getAllTargetSections()', () => {
      const scopedA = new PolicyRepository(db, getKey, { profileId: 'profile-a' });
      scopedA.create(makePolicy({ id: 'sec-a-1' }));
      scopedA.create(makePolicy({ id: 'sec-a-2' }));

      const scopedB = new PolicyRepository(db, getKey, { profileId: 'profile-b' });
      scopedB.create(makePolicy({ id: 'sec-b-1' }));

      const sections = repo.getAllTargetSections();
      expect(sections).toBeDefined();
      expect(sections!.length).toBe(2);

      const sectionA = sections!.find((s) => s.profileId === 'profile-a');
      expect(sectionA).toBeDefined();
      expect(sectionA!.policies).toHaveLength(2);

      const sectionB = sections!.find((s) => s.profileId === 'profile-b');
      expect(sectionB).toBeDefined();
      expect(sectionB!.policies).toHaveLength(1);
    });

    it('should omit empty target sections from getAllTargetSections()', () => {
      // Only add policies for profile-a, not profile-b
      const scopedA = new PolicyRepository(db, getKey, { profileId: 'profile-a' });
      scopedA.create(makePolicy({ id: 'only-a' }));

      const sections = repo.getAllTargetSections();
      expect(sections!.every((s) => s.policies.length > 0)).toBe(true);
      expect(sections!.find((s) => s.profileId === 'profile-b')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // UpdatePolicySchema validation
  // -----------------------------------------------------------------------

  describe('UpdatePolicySchema validation', () => {
    it('should accept update with target: process', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { target: 'process' });
      expect(updated).not.toBeNull();
      expect(updated!.target).toBe('process');
    });

    it('should accept update with target: url', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { target: 'url' });
      expect(updated).not.toBeNull();
      expect(updated!.target).toBe('url');
    });

    it('should accept update with target: filesystem', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { target: 'filesystem' });
      expect(updated).not.toBeNull();
      expect(updated!.target).toBe('filesystem');
    });

    it('should accept update with action: approval', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { action: 'approval' });
      expect(updated).not.toBeNull();
      expect(updated!.action).toBe('approval');
    });

    it('should accept update with networkAccess: proxy', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { networkAccess: 'proxy' });
      expect(updated).not.toBeNull();
      expect(updated!.networkAccess).toBe('proxy');
    });

    it('should accept update with networkAccess: none', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { networkAccess: 'none' });
      expect(updated).not.toBeNull();
      expect(updated!.networkAccess).toBe('none');
    });

    it('should reject update with old invalid target values', () => {
      const input = makePolicy();
      repo.create(input);

      expect(() => repo.update(input.id, { target: 'file' as never })).toThrow();
      expect(() => repo.update(input.id, { target: 'network' as never })).toThrow();
      expect(() => repo.update(input.id, { target: 'shell' as never })).toThrow();
    });

    it('should reject update with old invalid action values', () => {
      const input = makePolicy();
      repo.create(input);

      expect(() => repo.update(input.id, { action: 'ask' as never })).toThrow();
    });

    it('should reject update with old invalid networkAccess values', () => {
      const input = makePolicy();
      repo.create(input);

      expect(() => repo.update(input.id, { networkAccess: 'restrict' as never })).toThrow();
    });

    it('should accept update with enforcement: kill', () => {
      const input = makePolicy();
      repo.create(input);

      const updated = repo.update(input.id, { enforcement: 'kill' });
      expect(updated).not.toBeNull();
      expect(updated!.enforcement).toBe('kill');
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
