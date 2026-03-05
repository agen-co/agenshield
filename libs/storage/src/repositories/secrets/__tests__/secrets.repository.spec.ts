import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { deriveKey, generateSalt } from '../../../crypto';
import { StorageLockedError } from '../../../errors';
import { SecretsRepository } from '../secrets.repository';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
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

const key = deriveKey('test-passcode', generateSalt());

let counter = 0;

function makeSecret(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    name: `secret-${counter}`,
    value: `value-${counter}`,
    ...overrides,
  };
}

/** Insert a profile directly for FK constraints */
function insertProfile(db: Database.Database, id?: string): string {
  const profileId = id ?? `profile-${++counter}`;
  db.prepare(
    "INSERT INTO profiles (id, name, type, created_at, updated_at) VALUES (?, ?, 'target', datetime('now'), datetime('now'))",
  ).run(profileId, `Profile ${profileId}`);
  return profileId;
}

/** Insert a policy directly for junction table tests */
function insertPolicy(db: Database.Database): string {
  const id = `policy-${++counter}`;
  db.prepare(
    "INSERT INTO policies (id, name, action, target, patterns, created_at, updated_at) VALUES (?, ?, 'allow', 'command', '[]', datetime('now'), datetime('now'))",
  ).run(id, `Policy ${id}`);
  return id;
}

describe('SecretsRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: SecretsRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new SecretsRepository(db, () => key);
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Encryption round-trip
  // ---------------------------------------------------------------------------
  describe('encryption', () => {
    it('encrypts on create and decrypts on getById', () => {
      const secret = repo.create(makeSecret({ value: 'my-secret-value' }));
      expect(secret.value).toBe('my-secret-value');

      // Verify DB stores encrypted value
      const row = db.prepare('SELECT value_encrypted FROM secrets WHERE id = ?').get(secret.id) as { value_encrypted: string };
      expect(row.value_encrypted).not.toBe('my-secret-value');
      expect(row.value_encrypted.length).toBeGreaterThan(0);

      // Verify getById decrypts
      const found = repo.getById(secret.id);
      expect(found!.value).toBe('my-secret-value');
    });

    it('round-trips unicode values', () => {
      const value = 'Hello \u{1F600} Secret \u{1F30D}';
      const secret = repo.create(makeSecret({ value }));
      const found = repo.getById(secret.id);
      expect(found!.value).toBe(value);
    });
  });

  // ---------------------------------------------------------------------------
  // Locked state
  // ---------------------------------------------------------------------------
  describe('locked state', () => {
    let lockedRepo: SecretsRepository;

    beforeEach(() => {
      lockedRepo = new SecretsRepository(db, () => null);
    });

    it('create throws StorageLockedError when locked', () => {
      expect(() => lockedRepo.create(makeSecret())).toThrow(StorageLockedError);
    });

    it('getById throws StorageLockedError when locked', () => {
      // Create with unlocked repo first
      const secret = repo.create(makeSecret());
      expect(() => lockedRepo.getById(secret.id)).toThrow(StorageLockedError);
    });

    it('getAll throws StorageLockedError when locked', () => {
      repo.create(makeSecret());
      expect(() => lockedRepo.getAll()).toThrow(StorageLockedError);
    });

    it('getAllMasked works when locked', () => {
      repo.create(makeSecret({ name: 'test-secret' }));
      const masked = lockedRepo.getAllMasked();
      expect(masked.length).toBe(1);
      expect(masked[0].value).toBe('••••••••');
      expect(masked[0].name).toBe('test-secret');
    });

    it('delete works regardless of lock state', () => {
      const secret = repo.create(makeSecret());
      expect(lockedRepo.delete(secret.id)).toBe(true);
    });

    it('update with value throws StorageLockedError when locked', () => {
      const secret = repo.create(makeSecret());
      expect(() => lockedRepo.update(secret.id, { value: 'new' })).toThrow(StorageLockedError);
    });
  });

  // ---------------------------------------------------------------------------
  // Scope defaults
  // ---------------------------------------------------------------------------
  describe('scope defaults', () => {
    it('defaults to global scope when no policyIds', () => {
      const secret = repo.create(makeSecret());
      expect(secret.scope).toBe('global');
    });

    it('defaults to policed scope when policyIds provided', () => {
      const policyId = insertPolicy(db);
      const secret = repo.create(makeSecret({ policyIds: [policyId] }));
      expect(secret.scope).toBe('policed');
    });

    it('explicit standalone scope has no policy links', () => {
      const secret = repo.create(makeSecret({ scope: 'standalone' }));
      expect(secret.scope).toBe('standalone');
      expect(secret.policyIds).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Policy links
  // ---------------------------------------------------------------------------
  describe('policy links', () => {
    it('creates with policy links and verifies junction table', () => {
      const p1 = insertPolicy(db);
      const p2 = insertPolicy(db);
      const secret = repo.create(makeSecret({ policyIds: [p1, p2] }));
      expect(secret.policyIds.sort()).toEqual([p1, p2].sort());

      // Verify junction table
      const found = repo.getById(secret.id);
      expect(found!.policyIds.sort()).toEqual([p1, p2].sort());
    });

    it('standalone scope ignores policyIds', () => {
      const policyId = insertPolicy(db);
      const secret = repo.create(makeSecret({ scope: 'standalone', policyIds: [policyId] }));
      expect(secret.policyIds).toEqual([]);
    });

    it('updates policy links', () => {
      const p1 = insertPolicy(db);
      const p2 = insertPolicy(db);
      const secret = repo.create(makeSecret({ policyIds: [p1] }));

      const updated = repo.update(secret.id, { policyIds: [p2] });
      expect(updated!.policyIds).toEqual([p2]);
    });
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('creates a secret and returns it', () => {
      const secret = repo.create(makeSecret());
      expect(secret.id).toBeDefined();
      expect(secret.name).toMatch(/^secret-/);
      expect(secret.createdAt).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getById
  // ---------------------------------------------------------------------------
  describe('getById', () => {
    it('returns null for non-existent ID', () => {
      expect(repo.getById('nonexistent')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getByName
  // ---------------------------------------------------------------------------
  describe('getByName', () => {
    it('returns secret by name', () => {
      repo.create(makeSecret({ name: 'MY_API_KEY' }));
      const found = repo.getByName('MY_API_KEY');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('MY_API_KEY');
    });

    it('returns null for unknown name', () => {
      expect(repo.getByName('nonexistent')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getAll
  // ---------------------------------------------------------------------------
  describe('getAll', () => {
    it('returns all secrets with decrypted values', () => {
      repo.create(makeSecret({ value: 'val1' }));
      repo.create(makeSecret({ value: 'val2' }));
      const all = repo.getAll();
      expect(all.length).toBe(2);
      expect(all.map(s => s.value).sort()).toEqual(['val1', 'val2']);
    });

    it('returns empty array when none exist', () => {
      expect(repo.getAll()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getAllMasked
  // ---------------------------------------------------------------------------
  describe('getAllMasked', () => {
    it('returns masked values', () => {
      repo.create(makeSecret({ value: 'sensitive-data' }));
      const masked = repo.getAllMasked();
      expect(masked.length).toBe(1);
      expect(masked[0].value).toBe('••••••••');
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('re-encrypts value on update', () => {
      const secret = repo.create(makeSecret({ value: 'old-value' }));
      const updated = repo.update(secret.id, { value: 'new-value' });
      expect(updated!.value).toBe('new-value');

      // Verify in DB
      const found = repo.getById(secret.id);
      expect(found!.value).toBe('new-value');
    });

    it('updates scope', () => {
      const secret = repo.create(makeSecret());
      const updated = repo.update(secret.id, { scope: 'standalone' });
      expect(updated!.scope).toBe('standalone');
    });

    it('switching to standalone clears policy links', () => {
      const policyId = insertPolicy(db);
      const secret = repo.create(makeSecret({ policyIds: [policyId] }));
      expect(secret.policyIds).toEqual([policyId]);

      const updated = repo.update(secret.id, { scope: 'standalone' });
      expect(updated!.policyIds).toEqual([]);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.update('nonexistent', { value: 'x' })).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('deletes a secret', () => {
      const secret = repo.create(makeSecret());
      expect(repo.delete(secret.id)).toBe(true);
      expect(repo.getById(secret.id)).toBeNull();
    });

    it('returns false for non-existent ID', () => {
      expect(repo.delete('nonexistent')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Scoped resolution
  // ---------------------------------------------------------------------------
  describe('scoped resolution', () => {
    it('most-specific-wins: profile secret overrides global', () => {
      const profileId = insertProfile(db);

      // Create a global secret
      repo.create(makeSecret({ name: 'SHARED', value: 'global-val' }));

      // Create a profile-scoped secret with same name
      const scopedRepo = new SecretsRepository(db, () => key, { profileId });
      scopedRepo.create(makeSecret({ name: 'SHARED', value: 'profile-val' }));

      // Scoped getByName should return profile version
      const found = scopedRepo.getByName('SHARED');
      expect(found).not.toBeNull();
      expect(found!.value).toBe('profile-val');
    });

    it('scoped getAll uses getScopedRows with union + dedup', () => {
      const profileId = insertProfile(db);

      // Create global and profile secrets
      repo.create(makeSecret({ name: 'GLOBAL_ONLY', value: 'g1' }));
      const scopedRepo = new SecretsRepository(db, () => key, { profileId });
      scopedRepo.create(makeSecret({ name: 'PROFILE_ONLY', value: 'p1' }));

      const all = scopedRepo.getAll();
      expect(all.length).toBeGreaterThanOrEqual(1);
      const names = all.map(s => s.name);
      expect(names).toContain('PROFILE_ONLY');
    });

    it('scoped getAllMasked uses getScopedRows', () => {
      const profileId = insertProfile(db);
      const scopedRepo = new SecretsRepository(db, () => key, { profileId });
      scopedRepo.create(makeSecret({ name: 'SCOPED_SECRET', value: 'val' }));

      const masked = scopedRepo.getAllMasked();
      expect(masked.length).toBeGreaterThanOrEqual(1);
      expect(masked[0].value).toBe('••••••••');
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('Performance', () => {
    it('1000 creates with encryption', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.create({ name: `secret-perf-${i}`, value: `value-${i}` });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[secrets] create: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 reads with decryption', () => {
      const secret = repo.create(makeSecret());
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.getById(secret.id);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[secrets] getById: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });
  });
});
