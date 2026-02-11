import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../migrations/001-initial-schema';
import { TargetRepository } from '../target.repository';
import { ValidationError } from '../../../errors';

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

function insertUser(db: Database.Database, username: string): void {
  db.prepare(
    `INSERT INTO users (username, uid, type, created_at, home_dir)
     VALUES (?, ?, 'agent', ?, '/home/test')`,
  ).run(username, 1000, new Date().toISOString());
}

describe('TargetRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: TargetRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new TargetRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------
  describe('CRUD', () => {
    it('create returns a target with timestamps', () => {
      const target = repo.create({ id: 'my-target', name: 'My Target' });
      expect(target.id).toBe('my-target');
      expect(target.name).toBe('My Target');
      expect(target.createdAt).toBeDefined();
      expect(target.updatedAt).toBeDefined();
    });

    it('create with optional fields', () => {
      const target = repo.create({
        id: 'full-target',
        name: 'Full',
        presetId: 'preset-1',
        description: 'A full target',
      });
      expect(target.presetId).toBe('preset-1');
      expect(target.description).toBe('A full target');
    });

    it('getById returns the target', () => {
      repo.create({ id: 'abc', name: 'ABC' });
      const found = repo.getById('abc');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('abc');
      expect(found!.name).toBe('ABC');
    });

    it('getById returns null for non-existent id', () => {
      expect(repo.getById('missing')).toBeNull();
    });

    it('getAll returns all targets ordered by name', () => {
      repo.create({ id: 'b-target', name: 'Bravo' });
      repo.create({ id: 'a-target', name: 'Alpha' });
      repo.create({ id: 'c-target', name: 'Charlie' });
      const all = repo.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].name).toBe('Alpha');
      expect(all[1].name).toBe('Bravo');
      expect(all[2].name).toBe('Charlie');
    });

    it('getAll returns empty array when no targets exist', () => {
      expect(repo.getAll()).toEqual([]);
    });

    it('update modifies fields and returns the updated target', () => {
      repo.create({ id: 'upd', name: 'Original' });
      const updated = repo.update('upd', { name: 'Renamed', description: 'Desc' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Renamed');
      expect(updated!.description).toBe('Desc');
    });

    it('update returns null for non-existent id', () => {
      expect(repo.update('missing', { name: 'X' })).toBeNull();
    });

    it('update changes updatedAt timestamp', async () => {
      const original = repo.create({ id: 'ts-test', name: 'TS' });
      // Small delay to ensure timestamp differs (ISO string has ms precision)
      await new Promise((resolve) => setTimeout(resolve, 5));
      const updated = repo.update('ts-test', { name: 'TS2' });
      expect(updated!.updatedAt).not.toBe(original.updatedAt);
    });

    it('delete removes the target', () => {
      repo.create({ id: 'del', name: 'Delete Me' });
      expect(repo.delete('del')).toBe(true);
      expect(repo.getById('del')).toBeNull();
    });

    it('delete returns false for non-existent id', () => {
      expect(repo.delete('missing')).toBe(false);
    });

    it('create with duplicate id throws', () => {
      repo.create({ id: 'dup', name: 'First' });
      expect(() => repo.create({ id: 'dup', name: 'Second' })).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  describe('Users', () => {
    beforeEach(() => {
      repo.create({ id: 'tgt-1', name: 'Target 1' });
      insertUser(db, 'alice');
      insertUser(db, 'bob');
    });

    it('addUser associates a user with a target', () => {
      const tu = repo.addUser({ targetId: 'tgt-1', userUsername: 'alice', role: 'agent' });
      expect(tu.targetId).toBe('tgt-1');
      expect(tu.userUsername).toBe('alice');
      expect(tu.role).toBe('agent');
      expect(tu.createdAt).toBeDefined();
    });

    it('getUsers returns all users for a target', () => {
      repo.addUser({ targetId: 'tgt-1', userUsername: 'alice', role: 'agent' });
      repo.addUser({ targetId: 'tgt-1', userUsername: 'bob', role: 'broker' });
      const users = repo.getUsers('tgt-1');
      expect(users).toHaveLength(2);
      const usernames = users.map((u) => u.userUsername).sort();
      expect(usernames).toEqual(['alice', 'bob']);
    });

    it('getUsers returns empty array when no users assigned', () => {
      expect(repo.getUsers('tgt-1')).toEqual([]);
    });

    it('removeUser removes a user from a target', () => {
      repo.addUser({ targetId: 'tgt-1', userUsername: 'alice', role: 'agent' });
      expect(repo.removeUser({ targetId: 'tgt-1', userUsername: 'alice' })).toBe(true);
      expect(repo.getUsers('tgt-1')).toEqual([]);
    });

    it('removeUser returns false if user was not assigned', () => {
      expect(repo.removeUser({ targetId: 'tgt-1', userUsername: 'alice' })).toBe(false);
    });

    it('addUser with broker role', () => {
      const tu = repo.addUser({ targetId: 'tgt-1', userUsername: 'bob', role: 'broker' });
      expect(tu.role).toBe('broker');
    });

    it('deleting a target cascades to target_users', () => {
      repo.addUser({ targetId: 'tgt-1', userUsername: 'alice', role: 'agent' });
      repo.delete('tgt-1');
      // The target_users rows should be gone due to ON DELETE CASCADE
      const rows = db.prepare('SELECT * FROM target_users WHERE target_id = ?').all('tgt-1');
      expect(rows).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation errors
  // ---------------------------------------------------------------------------
  describe('Validation', () => {
    it('create rejects missing id', () => {
      expect(() => repo.create({ name: 'No ID' })).toThrow(ValidationError);
    });

    it('create rejects empty name', () => {
      expect(() => repo.create({ id: 'v1', name: '' })).toThrow(ValidationError);
    });

    it('create rejects name exceeding max length', () => {
      expect(() => repo.create({ id: 'v2', name: 'x'.repeat(101) })).toThrow(ValidationError);
    });

    it('create rejects invalid id format (uppercase)', () => {
      expect(() => repo.create({ id: 'UPPER', name: 'Bad' })).toThrow(ValidationError);
    });

    it('create rejects id starting with hyphen', () => {
      expect(() => repo.create({ id: '-bad', name: 'Bad' })).toThrow(ValidationError);
    });

    it('create rejects description exceeding max length', () => {
      expect(() =>
        repo.create({ id: 'v3', name: 'OK', description: 'x'.repeat(501) }),
      ).toThrow(ValidationError);
    });

    it('update rejects empty name', () => {
      repo.create({ id: 'val', name: 'Valid' });
      expect(() => repo.update('val', { name: '' })).toThrow(ValidationError);
    });

    it('addUser rejects invalid role', () => {
      repo.create({ id: 'val', name: 'Valid' });
      insertUser(db, 'charlie');
      expect(() =>
        repo.addUser({ targetId: 'val', userUsername: 'charlie', role: 'admin' }),
      ).toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('Performance', () => {
    it('insert 1000 targets and measure ops/sec', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.create({ id: `perf-${i}`, name: `Target ${i}` });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[target] Insert: ${count} targets in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('read all targets after bulk insert and measure ops/sec', () => {
      const count = 1000;
      for (let i = 0; i < count; i++) {
        repo.create({ id: `perf-r-${i}`, name: `Target ${i}` });
      }

      const iterations = 100;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        repo.getAll();
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((iterations / elapsed) * 1000);
      console.log(`[target] Read all (${count} rows): ${iterations} reads in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(10);
    });

    it('getById 1000 times and measure ops/sec', () => {
      repo.create({ id: 'lookup-target', name: 'Lookup' });

      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.getById('lookup-target');
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[target] getById: ${count} lookups in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(1000);
    });
  });
});
