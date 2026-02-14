import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { ConfigRepository } from '../config.repository';
import type { ConfigData } from '../config.model';

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

/** Insert a profile row so we can use it for scoped config. */
function insertProfile(db: Database.Database, id: string, name?: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profiles (id, name, type, created_at, updated_at) VALUES (?, ?, 'target', ?, ?)`,
  ).run(id, name ?? `Profile ${id}`, now, now);
}

describe('ConfigRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: ConfigRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new ConfigRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------
  describe('CRUD', () => {
    it('set and get base config', () => {
      const data: ConfigData = { daemonPort: 5200, daemonHost: 'localhost' };
      repo.set(data);

      const result = repo.get();
      expect(result).not.toBeNull();
      expect(result!.daemonPort).toBe(5200);
      expect(result!.daemonHost).toBe('localhost');
    });

    it('get returns null when no config exists', () => {
      expect(repo.get()).toBeNull();
    });

    it('set overwrites existing values via upsert (profile-scoped)', () => {
      insertProfile(db, 'upsert-profile');
      const scope = { profileId: 'upsert-profile' };
      const scopedRepo = new ConfigRepository(db, () => null, scope);
      scopedRepo.set({ daemonPort: 5200 });
      scopedRepo.set({ daemonPort: 6969 });
      const result = scopedRepo.getRaw();
      expect(result!.daemonPort).toBe(6969);
    });

    it('set preserves existing values when new values are null (COALESCE)', () => {
      insertProfile(db, 'coalesce-profile');
      const scope = { profileId: 'coalesce-profile' };
      const scopedRepo = new ConfigRepository(db, () => null, scope);
      scopedRepo.set({ daemonPort: 5200, daemonHost: 'localhost' });
      scopedRepo.set({ daemonHost: '0.0.0.0' });
      const result = scopedRepo.getRaw();
      expect(result!.daemonPort).toBe(5200);
      expect(result!.daemonHost).toBe('0.0.0.0');
    });

    it('getRaw returns the unmerged row for base scope', () => {
      repo.set({ daemonPort: 5200 });
      const raw = repo.getRaw();
      expect(raw).not.toBeNull();
      expect(raw!.daemonPort).toBe(5200);
    });

    it('getRaw returns null when no row for that scope', () => {
      const missingRepo = new ConfigRepository(db, () => null, { profileId: 'missing' });
      expect(missingRepo.getRaw()).toBeNull();
    });

    it('delete removes base config', () => {
      repo.set({ daemonPort: 5200 });
      expect(repo.delete()).toBe(true);
      expect(repo.get()).toBeNull();
    });

    it('delete returns false when nothing to delete', () => {
      expect(repo.delete()).toBe(false);
    });

    it('boolean fields round-trip correctly', () => {
      repo.set({ daemonEnableHostsEntry: true, vaultEnabled: false });
      const result = repo.get();
      expect(result!.daemonEnableHostsEntry).toBe(true);
      expect(result!.vaultEnabled).toBe(false);
    });

    it('set all config fields', () => {
      const full: ConfigData = {
        version: '1.0.0',
        daemonPort: 5200,
        daemonHost: '127.0.0.1',
        daemonLogLevel: 'debug',
        daemonEnableHostsEntry: true,
        defaultAction: 'deny',
        vaultEnabled: true,
        vaultProvider: 'local',
        skillsJson: '{"skills":[]}',
        soulJson: '{"soul":{}}',
        brokerJson: '{"broker":{}}',
      };
      repo.set(full);
      const result = repo.get();
      expect(result!.version).toBe('1.0.0');
      expect(result!.daemonPort).toBe(5200);
      expect(result!.daemonHost).toBe('127.0.0.1');
      expect(result!.daemonLogLevel).toBe('debug');
      expect(result!.daemonEnableHostsEntry).toBe(true);
      expect(result!.defaultAction).toBe('deny');
      expect(result!.vaultEnabled).toBe(true);
      expect(result!.vaultProvider).toBe('local');
      expect(result!.skillsJson).toBe('{"skills":[]}');
      expect(result!.soulJson).toBe('{"soul":{}}');
      expect(result!.brokerJson).toBe('{"broker":{}}');
    });
  });

  // ---------------------------------------------------------------------------
  // Scoping
  // ---------------------------------------------------------------------------
  describe('Scoping', () => {
    beforeEach(() => {
      insertProfile(db, 'prof-1');
    });

    it('profile-scoped config overrides base config', () => {
      repo.set({ daemonPort: 5200, daemonHost: 'base-host' });
      const scopedProf = new ConfigRepository(db, () => null, { profileId: 'prof-1' });
      scopedProf.set({ daemonPort: 7000 });

      const merged = scopedProf.get();
      expect(merged).not.toBeNull();
      expect(merged!.daemonPort).toBe(7000);
      expect(merged!.daemonHost).toBe('base-host');
    });

    it('getRaw returns only the exact scope level', () => {
      repo.set({ daemonPort: 5200 });
      const scopedProf = new ConfigRepository(db, () => null, { profileId: 'prof-1' });
      scopedProf.set({ daemonPort: 7000 });

      const baseRaw = repo.getRaw();
      expect(baseRaw!.daemonPort).toBe(5200);

      const profileRaw = scopedProf.getRaw();
      expect(profileRaw!.daemonPort).toBe(7000);
    });

    it('delete profile-scoped config does not affect base config', () => {
      repo.set({ daemonPort: 5200 });
      const scopedProf = new ConfigRepository(db, () => null, { profileId: 'prof-1' });
      scopedProf.set({ daemonPort: 7000 });

      scopedProf.delete();
      expect(scopedProf.getRaw()).toBeNull();
      expect(repo.get()!.daemonPort).toBe(5200);
    });

    it('get with no scope returns base config only', () => {
      repo.set({ daemonPort: 5200 });
      const scopedProf = new ConfigRepository(db, () => null, { profileId: 'prof-1' });
      scopedProf.set({ daemonPort: 7000 });
      const base = repo.get();
      expect(base!.daemonPort).toBe(5200);
    });

    it('NULL values in profile scope inherit from base', () => {
      repo.set({ daemonPort: 5200, daemonHost: 'base-host', daemonLogLevel: 'info' });
      const scopedProf = new ConfigRepository(db, () => null, { profileId: 'prof-1' });
      scopedProf.set({ daemonHost: 'profile-host' });

      const merged = scopedProf.get();
      expect(merged!.daemonPort).toBe(5200);
      expect(merged!.daemonHost).toBe('profile-host');
      expect(merged!.daemonLogLevel).toBe('info');
    });
  });

  // ---------------------------------------------------------------------------
  // Validation errors
  // ---------------------------------------------------------------------------
  describe('Validation', () => {
    it('set rejects non-integer port', () => {
      expect(() => repo.set({ daemonPort: 3.14 } as ConfigData)).toThrow();
    });

    it('set rejects negative port', () => {
      expect(() => repo.set({ daemonPort: -1 } as ConfigData)).toThrow();
    });

    it('set rejects zero port', () => {
      expect(() => repo.set({ daemonPort: 0 } as ConfigData)).toThrow();
    });

    it('set rejects wrong type for boolean fields', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => repo.set({ vaultEnabled: 'yes' } as any)).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('Performance', () => {
    it('1000 set operations and measure ops/sec', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.set({ daemonPort: 5200 + (i % 100), version: `1.0.${i}` });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[config] Set: ${count} upserts in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 get operations and measure ops/sec', () => {
      repo.set({ daemonPort: 5200, daemonHost: 'localhost', daemonLogLevel: 'info' });

      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.get();
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[config] Get: ${count} reads in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(1000);
    });

    it('1000 scoped get operations with merge and measure ops/sec', () => {
      insertProfile(db, 'perf-prof');
      repo.set({ daemonPort: 5200, daemonHost: 'base' });
      const scopedProf = new ConfigRepository(db, () => null, { profileId: 'perf-prof' });
      scopedProf.set({ daemonPort: 7000 });

      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        scopedProf.get();
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[config] Scoped get: ${count} merges in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(500);
    });
  });
});
