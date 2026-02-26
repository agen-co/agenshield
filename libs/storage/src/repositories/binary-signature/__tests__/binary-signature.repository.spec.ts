/**
 * BinarySignatureRepository — comprehensive tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { BinarySignaturesMigration } from '../../../migrations/020-binary-signatures';
import { BinarySignatureRepository } from '../binary-signature.repository';
import type { CreateSignatureInput } from '../binary-signature.schema';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-binsig-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new SchemaMigration().up(db);
  new BinarySignaturesMigration().up(db);
  return {
    db,
    cleanup: () => {
      db.close();
      try { fs.rmSync(dir, { recursive: true }); } catch { /* */ }
    },
  };
}

function makeSigInput(overrides?: Partial<CreateSignatureInput>): CreateSignatureInput {
  return {
    sha256: 'a'.repeat(64),
    packageName: 'openclaw',
    source: 'cloud',
    ...overrides,
  };
}

describe('BinarySignatureRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: BinarySignatureRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new BinarySignatureRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ─── CRUD ─────────────────────────────────────────────────

  describe('create', () => {
    it('should create a signature and return it', () => {
      const sig = repo.create(makeSigInput());
      expect(sig.id).toBeDefined();
      expect(sig.sha256).toBe('a'.repeat(64));
      expect(sig.packageName).toBe('openclaw');
      expect(sig.source).toBe('cloud');
      expect(sig.createdAt).toBeDefined();
      expect(sig.updatedAt).toBeDefined();
    });

    it('should store optional fields', () => {
      const sig = repo.create(makeSigInput({
        version: '2.1.0',
        platform: 'darwin',
        metadata: { arch: 'arm64' },
      }));
      expect(sig.version).toBe('2.1.0');
      expect(sig.platform).toBe('darwin');
      expect(sig.metadata).toEqual({ arch: 'arm64' });
    });

    it('should default source to cloud', () => {
      const sig = repo.create({
        sha256: 'b'.repeat(64),
        packageName: 'test-pkg',
      });
      expect(sig.source).toBe('cloud');
    });
  });

  // ─── Lookup ───────────────────────────────────────────────

  describe('lookupBySha256', () => {
    it('should find a signature by SHA256', () => {
      repo.create(makeSigInput());
      const found = repo.lookupBySha256('a'.repeat(64));
      expect(found).not.toBeNull();
      expect(found!.packageName).toBe('openclaw');
    });

    it('should return null for unknown hash', () => {
      const found = repo.lookupBySha256('x'.repeat(64));
      expect(found).toBeNull();
    });

    it('should prefer platform-specific match', () => {
      repo.create(makeSigInput({ platform: 'darwin', packageName: 'openclaw-darwin' }));
      repo.create(makeSigInput({
        sha256: 'a'.repeat(64),
        platform: 'linux',
        packageName: 'openclaw-linux',
      }));
      const found = repo.lookupBySha256('a'.repeat(64), 'darwin');
      expect(found!.packageName).toBe('openclaw-darwin');
    });

    it('should fall back to any platform when specific not found', () => {
      repo.create(makeSigInput({ platform: 'linux' }));
      const found = repo.lookupBySha256('a'.repeat(64), 'win32');
      expect(found).not.toBeNull();
      expect(found!.platform).toBe('linux');
    });
  });

  // ─── getByPackage ─────────────────────────────────────────

  describe('getByPackage', () => {
    it('should find all signatures for a package', () => {
      repo.create(makeSigInput({ sha256: 'a'.repeat(64), platform: 'darwin' }));
      repo.create(makeSigInput({ sha256: 'b'.repeat(64), platform: 'linux' }));
      repo.create(makeSigInput({ sha256: 'c'.repeat(64), packageName: 'other-pkg' }));

      const results = repo.getByPackage('openclaw');
      expect(results).toHaveLength(2);
    });
  });

  // ─── getAll ───────────────────────────────────────────────

  describe('getAll', () => {
    it('should return all signatures', () => {
      repo.create(makeSigInput({ sha256: 'a'.repeat(64) }));
      repo.create(makeSigInput({ sha256: 'b'.repeat(64), packageName: 'other' }));
      const all = repo.getAll();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no signatures', () => {
      expect(repo.getAll()).toEqual([]);
    });
  });

  // ─── upsertBatch ──────────────────────────────────────────

  describe('upsertBatch', () => {
    it('should insert multiple signatures', () => {
      const sigs: CreateSignatureInput[] = [
        { sha256: 'a'.repeat(64), packageName: 'pkg-a' },
        { sha256: 'b'.repeat(64), packageName: 'pkg-b' },
        { sha256: 'c'.repeat(64), packageName: 'pkg-c' },
      ];
      const count = repo.upsertBatch(sigs);
      expect(count).toBe(3);
      expect(repo.getAll()).toHaveLength(3);
    });

    it('should update existing entries on conflict', () => {
      repo.create(makeSigInput({ sha256: 'a'.repeat(64), packageName: 'old-name', platform: 'darwin' }));

      repo.upsertBatch([
        { sha256: 'a'.repeat(64), packageName: 'new-name', platform: 'darwin' },
      ]);

      const found = repo.lookupBySha256('a'.repeat(64), 'darwin');
      expect(found!.packageName).toBe('new-name');
      // Should not create a duplicate
      expect(repo.count()).toBe(1);
    });

    it('should handle different platforms as separate entries', () => {
      repo.upsertBatch([
        { sha256: 'a'.repeat(64), packageName: 'pkg', platform: 'darwin' },
        { sha256: 'a'.repeat(64), packageName: 'pkg', platform: 'linux' },
      ]);
      expect(repo.count()).toBe(2);
    });
  });

  // ─── deleteBySource ───────────────────────────────────────

  describe('deleteBySource', () => {
    it('should delete all signatures from a source', () => {
      repo.create(makeSigInput({ sha256: 'a'.repeat(64), source: 'cloud' }));
      repo.create(makeSigInput({ sha256: 'b'.repeat(64), source: 'cloud' }));
      repo.create(makeSigInput({ sha256: 'c'.repeat(64), source: 'local' }));

      const deleted = repo.deleteBySource('cloud');
      expect(deleted).toBe(2);
      expect(repo.getAll()).toHaveLength(1);
      expect(repo.getAll()[0].source).toBe('local');
    });
  });

  // ─── delete ───────────────────────────────────────────────

  describe('delete', () => {
    it('should delete a signature by ID', () => {
      const sig = repo.create(makeSigInput());
      expect(repo.delete(sig.id)).toBe(true);
      expect(repo.getById(sig.id)).toBeNull();
    });

    it('should return false for non-existent ID', () => {
      expect(repo.delete('non-existent')).toBe(false);
    });
  });

  // ─── Validation ───────────────────────────────────────────

  describe('validation', () => {
    it('should reject invalid SHA256 (too short)', () => {
      expect(() => repo.create({ sha256: 'short', packageName: 'pkg' })).toThrow();
    });

    it('should reject empty packageName', () => {
      expect(() => repo.create({ sha256: 'a'.repeat(64), packageName: '' })).toThrow();
    });

    it('should reject invalid source value', () => {
      expect(() => repo.create({
        sha256: 'a'.repeat(64),
        packageName: 'pkg',
        source: 'invalid' as 'cloud',
      })).toThrow();
    });
  });

  // ─── Performance ──────────────────────────────────────────

  describe('performance', () => {
    it('should handle bulk upsert of 1000 entries', () => {
      const sigs: CreateSignatureInput[] = [];
      for (let i = 0; i < 1000; i++) {
        const hash = i.toString(16).padStart(64, '0');
        sigs.push({ sha256: hash, packageName: `pkg-${i}`, source: 'cloud' });
      }

      const start = performance.now();
      const count = repo.upsertBatch(sigs);
      const elapsed = performance.now() - start;

      expect(count).toBe(1000);
      expect(repo.count()).toBe(1000);
      // Should complete in under 5 seconds even on slow CI
      expect(elapsed).toBeLessThan(5000);
    });

    it('should perform lookups efficiently', () => {
      // Insert 500 entries
      const sigs: CreateSignatureInput[] = [];
      for (let i = 0; i < 500; i++) {
        const hash = i.toString(16).padStart(64, '0');
        sigs.push({ sha256: hash, packageName: `pkg-${i}`, source: 'cloud' });
      }
      repo.upsertBatch(sigs);

      // Measure 100 lookups
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const hash = (i * 5).toString(16).padStart(64, '0');
        repo.lookupBySha256(hash);
      }
      const elapsed = performance.now() - start;

      // 100 lookups should complete in under 1 second
      expect(elapsed).toBeLessThan(1000);
    });
  });
});
