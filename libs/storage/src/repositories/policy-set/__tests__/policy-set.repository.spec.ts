import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { PolicySetRepository } from '../policy-set.repository';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-set-test-'));
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

let counter = 0;

function makePolicySet(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    name: `Policy Set ${counter}`,
    ...overrides,
  };
}

/** Insert a profile directly for FK constraints */
function insertProfile(db: Database.Database, id: string = `profile-${++counter}`): string {
  db.prepare(
    "INSERT INTO profiles (id, name, type, created_at, updated_at) VALUES (?, ?, 'target', datetime('now'), datetime('now'))",
  ).run(id, `Profile ${id}`);
  return id;
}

/** Insert a policy directly for member tests */
function insertPolicy(db: Database.Database, profileId?: string): string {
  const id = `policy-${++counter}`;
  db.prepare(
    "INSERT INTO policies (id, profile_id, name, action, target, patterns, created_at, updated_at) VALUES (?, ?, ?, 'allow', 'command', '[]', datetime('now'), datetime('now'))",
  ).run(id, profileId ?? null, `Policy ${id}`);
  return id;
}

describe('PolicySetRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: PolicySetRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new PolicySetRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('creates a policy set', () => {
      const ps = repo.create(makePolicySet());
      expect(ps.id).toBeDefined();
      expect(ps.name).toMatch(/Policy Set/);
      expect(ps.enforced).toBe(false);
      expect(ps.createdAt).toBeDefined();
      expect(ps.updatedAt).toBeDefined();
    });

    it('creates with parentId', () => {
      const parent = repo.create(makePolicySet());
      const child = repo.create(makePolicySet({ parentId: parent.id }));
      expect(child.parentId).toBe(parent.id);
    });

    it('creates with enforced flag', () => {
      const ps = repo.create(makePolicySet({ enforced: true }));
      expect(ps.enforced).toBe(true);
    });

    it('creates with profileId', () => {
      const profileId = insertProfile(db);
      const ps = repo.create(makePolicySet({ profileId }));
      expect(ps.profileId).toBe(profileId);
    });
  });

  // ---------------------------------------------------------------------------
  // getById
  // ---------------------------------------------------------------------------
  describe('getById', () => {
    it('returns policy set by ID', () => {
      const created = repo.create(makePolicySet());
      const found = repo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('nonexistent')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getAll
  // ---------------------------------------------------------------------------
  describe('getAll', () => {
    it('returns all policy sets', () => {
      repo.create(makePolicySet());
      repo.create(makePolicySet());
      expect(repo.getAll().length).toBe(2);
    });

    it('returns empty array when none exist', () => {
      expect(repo.getAll()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getByProfileId
  // ---------------------------------------------------------------------------
  describe('getByProfileId', () => {
    it('filters by profile', () => {
      const p1 = insertProfile(db);
      const p2 = insertProfile(db);
      repo.create(makePolicySet({ profileId: p1 }));
      repo.create(makePolicySet({ profileId: p1 }));
      repo.create(makePolicySet({ profileId: p2 }));

      expect(repo.getByProfileId(p1).length).toBe(2);
      expect(repo.getByProfileId(p2).length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getChildren
  // ---------------------------------------------------------------------------
  describe('getChildren', () => {
    it('returns child policy sets', () => {
      const parent = repo.create(makePolicySet());
      repo.create(makePolicySet({ parentId: parent.id }));
      repo.create(makePolicySet({ parentId: parent.id }));
      repo.create(makePolicySet());

      expect(repo.getChildren(parent.id).length).toBe(2);
    });

    it('returns empty array for leaf node', () => {
      const leaf = repo.create(makePolicySet());
      expect(repo.getChildren(leaf.id)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('updates name', () => {
      const created = repo.create(makePolicySet());
      const updated = repo.update(created.id, { name: 'Renamed' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Renamed');
    });

    it('updates parentId', () => {
      const parent = repo.create(makePolicySet());
      const child = repo.create(makePolicySet());
      const updated = repo.update(child.id, { parentId: parent.id });
      expect(updated!.parentId).toBe(parent.id);
    });

    it('clears parentId with null', () => {
      const parent = repo.create(makePolicySet());
      const child = repo.create(makePolicySet({ parentId: parent.id }));
      const updated = repo.update(child.id, { parentId: null });
      expect(updated!.parentId).toBeUndefined();
    });

    it('updates enforced flag', () => {
      const created = repo.create(makePolicySet());
      const updated = repo.update(created.id, { enforced: true });
      expect(updated!.enforced).toBe(true);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.update('nonexistent', { name: 'X' })).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('deletes a policy set', () => {
      const created = repo.create(makePolicySet());
      expect(repo.delete(created.id)).toBe(true);
      expect(repo.getById(created.id)).toBeNull();
    });

    it('returns false for non-existent ID', () => {
      expect(repo.delete('nonexistent')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------
  describe('members', () => {
    it('adds and retrieves member policy IDs', () => {
      const ps = repo.create(makePolicySet());
      const policyId = insertPolicy(db);
      repo.addMember(ps.id, policyId);

      const members = repo.getMemberPolicyIds(ps.id);
      expect(members).toEqual([policyId]);
    });

    it('duplicate addMember is ignored (INSERT OR IGNORE)', () => {
      const ps = repo.create(makePolicySet());
      const policyId = insertPolicy(db);
      repo.addMember(ps.id, policyId);
      repo.addMember(ps.id, policyId);

      expect(repo.getMemberPolicyIds(ps.id)).toEqual([policyId]);
    });

    it('removes a member', () => {
      const ps = repo.create(makePolicySet());
      const p1 = insertPolicy(db);
      const p2 = insertPolicy(db);
      repo.addMember(ps.id, p1);
      repo.addMember(ps.id, p2);
      repo.removeMember(ps.id, p1);

      expect(repo.getMemberPolicyIds(ps.id)).toEqual([p2]);
    });

    it('getMemberships returns sets containing a policy', () => {
      const ps1 = repo.create(makePolicySet());
      const ps2 = repo.create(makePolicySet());
      const policyId = insertPolicy(db);
      repo.addMember(ps1.id, policyId);
      repo.addMember(ps2.id, policyId);

      const memberships = repo.getMemberships(policyId);
      expect(memberships.sort()).toEqual([ps1.id, ps2.id].sort());
    });

    it('returns empty arrays for unknown IDs', () => {
      expect(repo.getMemberPolicyIds('unknown')).toEqual([]);
      expect(repo.getMemberships('unknown')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getParentChain
  // ---------------------------------------------------------------------------
  describe('getParentChain', () => {
    it('walks a linear parent chain', () => {
      const root = repo.create(makePolicySet({ name: 'Root' }));
      const mid = repo.create(makePolicySet({ name: 'Mid', parentId: root.id }));
      const leaf = repo.create(makePolicySet({ name: 'Leaf', parentId: mid.id }));

      const chain = repo.getParentChain(leaf.id);
      expect(chain.map(ps => ps.name)).toEqual(['Leaf', 'Mid', 'Root']);
    });

    it('returns single-element chain for root node', () => {
      const root = repo.create(makePolicySet({ name: 'Root' }));
      const chain = repo.getParentChain(root.id);
      expect(chain.length).toBe(1);
      expect(chain[0].name).toBe('Root');
    });

    it('handles cycle detection (stops traversal)', () => {
      // Create chain A -> B -> C, then make C point back to A
      const a = repo.create(makePolicySet({ name: 'A' }));
      const b = repo.create(makePolicySet({ name: 'B', parentId: a.id }));
      const c = repo.create(makePolicySet({ name: 'C', parentId: b.id }));

      // Force cycle: A's parent = C (bypassing normal validation)
      db.prepare('UPDATE policy_sets SET parent_id = ? WHERE id = ?').run(c.id, a.id);

      const chain = repo.getParentChain(c.id);
      // Should visit C, B, A then stop (A's parent is C which was already visited)
      expect(chain.length).toBe(3);
    });

    it('returns empty array for non-existent ID', () => {
      expect(repo.getParentChain('nonexistent')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('Performance', () => {
    it('1000 creates', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.create({ name: `Set ${i}` });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[policy-set] create: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 reads', () => {
      const created = repo.create(makePolicySet());
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.getById(created.id);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[policy-set] getById: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });
  });
});
