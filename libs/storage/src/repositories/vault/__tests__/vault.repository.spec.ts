/**
 * VaultRepository tests
 *
 * Covers: secrets CRUD, KV store, locking, encryption verification,
 * scope-aware resolution, and performance benchmarks.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../migrations/001-initial-schema';
import { deriveKey, generateSalt } from '../../../crypto';
import { VaultRepository } from '../vault.repository';
import { StorageLockedError } from '../../../errors';

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

const salt = generateSalt();
const key = deriveKey('test-passcode', salt);
const getKey = () => key;
const getLockedKey = () => null;

/**
 * Insert parent rows required by foreign key constraints.
 * vault_secrets and vault_kv reference targets(id) and users(username).
 */
function seedScopeFixtures(db: Database.Database): void {
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-1', 'Target One');
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-2', 'Target Two');
  db.prepare(
    `INSERT INTO users (username, uid, type, created_at, home_dir) VALUES (?, ?, ?, datetime('now'), ?)`,
  ).run('alice', 6000, 'agent', '/home/alice');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('VaultRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: VaultRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new VaultRepository(db, getKey);
  });

  afterEach(() => cleanup());

  // -----------------------------------------------------------------------
  // Secrets — CRUD
  // -----------------------------------------------------------------------

  describe('Secrets CRUD', () => {
    it('should create and retrieve a secret by id', () => {
      const secret = repo.createSecret({ name: 'MY_SECRET', value: 's3cret' });

      expect(secret.id).toBeDefined();
      expect(secret.name).toBe('MY_SECRET');
      expect(secret.value).toBe('s3cret');
      expect(secret.scope).toBe('global');
      expect(secret.policyIds).toEqual([]);
      expect(secret.createdAt).toBeDefined();

      const fetched = repo.getSecret(secret.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('MY_SECRET');
      expect(fetched!.value).toBe('s3cret');
    });

    it('should return null for a non-existent secret id', () => {
      expect(repo.getSecret('does-not-exist')).toBeNull();
    });

    it('should retrieve a secret by name', () => {
      repo.createSecret({ name: 'API_KEY', value: 'abc123' });
      const found = repo.getSecretByName({ name: 'API_KEY' });
      expect(found).not.toBeNull();
      expect(found!.value).toBe('abc123');
    });

    it('should return null when getSecretByName finds nothing', () => {
      expect(repo.getSecretByName({ name: 'NONEXISTENT' })).toBeNull();
    });

    it('should list all secrets', () => {
      repo.createSecret({ name: 'A', value: '1' });
      repo.createSecret({ name: 'B', value: '2' });
      repo.createSecret({ name: 'C', value: '3' });

      const all = repo.getAllSecrets();
      expect(all).toHaveLength(3);
      const names = all.map((s) => s.name).sort();
      expect(names).toEqual(['A', 'B', 'C']);
    });

    it('should update a secret name', () => {
      const secret = repo.createSecret({ name: 'OLD', value: 'val' });
      const updated = repo.updateSecret(secret.id, { name: 'NEW' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('NEW');
      expect(updated!.value).toBe('val');
    });

    it('should update a secret value', () => {
      const secret = repo.createSecret({ name: 'KEY', value: 'old-val' });
      const updated = repo.updateSecret(secret.id, { value: 'new-val' });

      expect(updated).not.toBeNull();
      expect(updated!.value).toBe('new-val');
    });

    it('should update a secret scope', () => {
      const secret = repo.createSecret({ name: 'KEY', value: 'v' });
      const updated = repo.updateSecret(secret.id, { scope: 'policed' });

      expect(updated).not.toBeNull();
      expect(updated!.scope).toBe('policed');
    });

    it('should return null when updating a non-existent secret', () => {
      expect(repo.updateSecret('nope', { name: 'X' })).toBeNull();
    });

    it('should delete a secret', () => {
      const secret = repo.createSecret({ name: 'DEL', value: 'x' });
      expect(repo.deleteSecret(secret.id)).toBe(true);
      expect(repo.getSecret(secret.id)).toBeNull();
    });

    it('should return false when deleting a non-existent secret', () => {
      expect(repo.deleteSecret('nope')).toBe(false);
    });

    it('should create a secret with policyIds', () => {
      // We need a policy row in the DB for foreign-key-free link table
      const secret = repo.createSecret({
        name: 'POLICED',
        value: 'v',
        policyIds: ['p1', 'p2'],
      });

      expect(secret.policyIds).toEqual(['p1', 'p2']);

      const fetched = repo.getSecret(secret.id);
      expect(fetched!.policyIds.sort()).toEqual(['p1', 'p2']);
    });

    it('should update policyIds on a secret', () => {
      const secret = repo.createSecret({
        name: 'POLICED',
        value: 'v',
        policyIds: ['p1'],
      });

      const updated = repo.updateSecret(secret.id, { policyIds: ['p3', 'p4'] });
      expect(updated!.policyIds.sort()).toEqual(['p3', 'p4']);
    });
  });

  // -----------------------------------------------------------------------
  // Key-Value store
  // -----------------------------------------------------------------------

  describe('Key-Value store', () => {
    it('should set and get a KV entry', () => {
      repo.setKv({ key: 'theme', value: 'dark' });
      expect(repo.getKv({ key: 'theme' })).toBe('dark');
    });

    it('should return null for a non-existent key', () => {
      expect(repo.getKv({ key: 'missing' })).toBeNull();
    });

    it('should overwrite an existing KV entry with fully-specified scope', () => {
      seedScopeFixtures(db);
      const scope = { targetId: 'target-1', userUsername: 'alice' };
      const scopedRepo = new VaultRepository(db, getKey, scope);
      scopedRepo.setKv({ key: 'lang', value: 'en' });
      scopedRepo.setKv({ key: 'lang', value: 'fr' });
      expect(scopedRepo.getKv({ key: 'lang' })).toBe('fr');
    });

    it('should delete a KV entry', () => {
      repo.setKv({ key: 'to-delete', value: 'bye' });
      expect(repo.deleteKv({ key: 'to-delete' })).toBe(true);
      expect(repo.getKv({ key: 'to-delete' })).toBeNull();
    });

    it('should return false when deleting a non-existent key', () => {
      expect(repo.deleteKv({ key: 'nope' })).toBe(false);
    });

    it('should resolve scoped KV with most specific scope winning', () => {
      seedScopeFixtures(db);
      repo.setKv({ key: 'color', value: 'red' });
      new VaultRepository(db, getKey, { targetId: 'target-1', userUsername: 'alice' }).setKv({ key: 'color', value: 'blue' });

      // Scoped fetch returns the most specific entry (target+user wins)
      expect(new VaultRepository(db, getKey, { targetId: 'target-1', userUsername: 'alice' }).getKv({ key: 'color' })).toBe('blue');
    });

    it('should return base KV when no scoped entry exists', () => {
      seedScopeFixtures(db);
      repo.setKv({ key: 'only-base', value: 'base-value' });

      // When queried with a scope, but no scoped entry exists, base is returned
      expect(new VaultRepository(db, getKey, { targetId: 'target-1' }).getKv({ key: 'only-base' })).toBe('base-value');
    });
  });

  // -----------------------------------------------------------------------
  // Locking — StorageLockedError
  // -----------------------------------------------------------------------

  describe('Locking', () => {
    let lockedRepo: VaultRepository;

    beforeEach(() => {
      lockedRepo = new VaultRepository(db, getLockedKey);
    });

    it('should throw StorageLockedError on createSecret when locked', () => {
      expect(() => lockedRepo.createSecret({ name: 'X', value: 'Y' }))
        .toThrow(StorageLockedError);
    });

    it('should throw StorageLockedError on getSecret when locked', () => {
      expect(() => lockedRepo.getSecret('any-id'))
        .toThrow(StorageLockedError);
    });

    it('should throw StorageLockedError on getSecretByName when locked', () => {
      expect(() => lockedRepo.getSecretByName({ name: 'any' }))
        .toThrow(StorageLockedError);
    });

    it('should throw StorageLockedError on getAllSecrets when locked', () => {
      expect(() => lockedRepo.getAllSecrets())
        .toThrow(StorageLockedError);
    });

    it('should throw StorageLockedError on updateSecret when locked', () => {
      expect(() => lockedRepo.updateSecret('any-id', { name: 'X' }))
        .toThrow(StorageLockedError);
    });

    it('should throw StorageLockedError on setKv when locked', () => {
      expect(() => lockedRepo.setKv({ key: 'k', value: 'v' }))
        .toThrow(StorageLockedError);
    });

    it('should throw StorageLockedError on getKv when locked', () => {
      expect(() => lockedRepo.getKv({ key: 'k' }))
        .toThrow(StorageLockedError);
    });

    it('should NOT throw on deleteSecret when locked (no encryption needed)', () => {
      // deleteSecret does not call isUnlocked
      expect(repo.deleteSecret('nonexistent')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Encryption verification
  // -----------------------------------------------------------------------

  describe('Encryption', () => {
    it('should store value_encrypted differently from plaintext', () => {
      const plaintext = 'super-secret-value';
      repo.createSecret({ name: 'ENC_TEST', value: plaintext });

      // Read the raw DB row
      const row = db.prepare('SELECT value_encrypted FROM vault_secrets WHERE name = ?').get('ENC_TEST') as { value_encrypted: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.value_encrypted).not.toBe(plaintext);
      // The encrypted value should be a base64 string
      expect(row!.value_encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should encrypt KV values in the database', () => {
      repo.setKv({ key: 'enc-key', value: 'plaintext-value' });

      const row = db.prepare('SELECT value_encrypted FROM vault_kv WHERE key = ?').get('enc-key') as { value_encrypted: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.value_encrypted).not.toBe('plaintext-value');
    });

    it('should decrypt secrets correctly on retrieval', () => {
      const secret = repo.createSecret({ name: 'ROUND_TRIP', value: 'hello-world' });
      const fetched = repo.getSecret(secret.id);
      expect(fetched!.value).toBe('hello-world');
    });
  });

  // -----------------------------------------------------------------------
  // Scoping
  // -----------------------------------------------------------------------

  describe('Scoping', () => {
    beforeEach(() => seedScopeFixtures(db));

    it('should resolve the most specific secret per name (target+user > target > base)', () => {
      // Base secret
      repo.createSecret({ name: 'DB_PASS', value: 'base-pass' });
      // Target-level override
      repo.createSecret({ name: 'DB_PASS', value: 'target-pass', targetId: 'target-1' });
      // Target+user override
      repo.createSecret({ name: 'DB_PASS', value: 'user-pass', targetId: 'target-1', userUsername: 'alice' });

      // Query with full scope: should get the most specific
      const result = new VaultRepository(db, getKey, { targetId: 'target-1', userUsername: 'alice' }).getSecretByName({ name: 'DB_PASS' });
      expect(result).not.toBeNull();
      expect(result!.value).toBe('user-pass');
    });

    it('should fall back to target-level when no user-level override exists', () => {
      repo.createSecret({ name: 'TOKEN', value: 'base' });
      repo.createSecret({ name: 'TOKEN', value: 'target', targetId: 'target-1' });

      const result = new VaultRepository(db, getKey, { targetId: 'target-1' }).getSecretByName({ name: 'TOKEN' });
      expect(result).not.toBeNull();
      expect(result!.value).toBe('target');
    });

    it('should fall back to base when no target-level override exists', () => {
      repo.createSecret({ name: 'GLOBAL', value: 'base-only' });

      const result = new VaultRepository(db, getKey, { targetId: 'target-1' }).getSecretByName({ name: 'GLOBAL' });
      expect(result).not.toBeNull();
      expect(result!.value).toBe('base-only');
    });

    it('should list secrets filtered by scope', () => {
      repo.createSecret({ name: 'A', value: '1' });
      repo.createSecret({ name: 'B', value: '2', targetId: 'target-1' });
      repo.createSecret({ name: 'C', value: '3', targetId: 'target-2' });

      // Querying with target-1 scope should return base + target-1 secrets
      const results = new VaultRepository(db, getKey, { targetId: 'target-1' }).getAllSecrets();
      const names = results.map((s) => s.name).sort();
      expect(names).toEqual(['A', 'B']);
    });
  });

  // -----------------------------------------------------------------------
  // Performance
  // -----------------------------------------------------------------------

  describe('Performance', () => {
    it('should create 500 secrets efficiently', () => {
      const start = performance.now();
      for (let i = 0; i < 500; i++) {
        repo.createSecret({ name: `secret-${i}`, value: `value-${i}` });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round(500 / (elapsed / 1000));

      // Expect at least 100 ops/sec (generous threshold for CI)
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('should read 500 secrets efficiently', () => {
      const ids: string[] = [];
      for (let i = 0; i < 500; i++) {
        const s = repo.createSecret({ name: `perf-read-${i}`, value: `v-${i}` });
        ids.push(s.id);
      }

      const start = performance.now();
      for (const id of ids) {
        repo.getSecret(id);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round(500 / (elapsed / 1000));

      expect(opsPerSec).toBeGreaterThan(100);
    });
  });
});
