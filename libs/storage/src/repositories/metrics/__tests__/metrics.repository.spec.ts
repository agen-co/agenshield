import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { MetricsRepository } from '../metrics.repository';
import { mapMetricsSnapshot } from '../metrics.model';
import type { DbMetricsRow } from '../metrics.model';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return {
    db,
    cleanup: () => {
      db.close();
      try { fs.rmSync(dir, { recursive: true }); } catch { /* */ }
    },
  };
}

let counter = 0;

function makeMetrics(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    timestamp: Date.now() + counter,
    cpuPercent: 50 + (counter % 50),
    memPercent: 60,
    diskPercent: 70,
    netUp: 1000,
    netDown: 2000,
    ...overrides,
  };
}

describe('MetricsRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: MetricsRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    // MetricsRepository creates its own table in constructor
    repo = new MetricsRepository(db);
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('inserts a metrics snapshot', () => {
      repo.create(makeMetrics());
      expect(repo.count()).toBe(1);
    });

    it('creates with optional targetId', () => {
      repo.create(makeMetrics({ targetId: 'target-1' }));
      const recent = repo.getRecentForTarget('target-1');
      expect(recent.length).toBe(1);
      expect(recent[0].targetId).toBe('target-1');
    });

    it('creates with optional el fields', () => {
      repo.create(makeMetrics({
        elMin: 1.5, elMax: 100.2, elMean: 50.0, elP50: 45.0, elP99: 95.0,
      }));
      const recent = repo.getRecent(1);
      expect(recent[0].elMin).toBe(1.5);
      expect(recent[0].elMax).toBe(100.2);
      expect(recent[0].elMean).toBe(50.0);
      expect(recent[0].elP50).toBe(45.0);
      expect(recent[0].elP99).toBe(95.0);
    });

    it('optional fields are undefined when not provided', () => {
      repo.create(makeMetrics());
      const recent = repo.getRecent(1);
      expect(recent[0].targetId).toBeUndefined();
      expect(recent[0].elMin).toBeUndefined();
      expect(recent[0].elMax).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getRecent
  // ---------------------------------------------------------------------------
  describe('getRecent', () => {
    it('returns system-wide snapshots in oldest->newest order', () => {
      const ts1 = Date.now();
      repo.create(makeMetrics({ timestamp: ts1 }));
      repo.create(makeMetrics({ timestamp: ts1 + 1000 }));
      repo.create(makeMetrics({ timestamp: ts1 + 2000 }));

      const recent = repo.getRecent(10);
      expect(recent.length).toBe(3);
      expect(recent[0].timestamp).toBe(ts1);
      expect(recent[2].timestamp).toBe(ts1 + 2000);
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        repo.create(makeMetrics());
      }
      const recent = repo.getRecent(3);
      expect(recent.length).toBe(3);
    });

    it('excludes target-specific snapshots', () => {
      repo.create(makeMetrics());
      repo.create(makeMetrics({ targetId: 'target-1' }));
      const recent = repo.getRecent(10);
      expect(recent.length).toBe(1);
    });

    it('returns empty array when no data', () => {
      expect(repo.getRecent()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getSince
  // ---------------------------------------------------------------------------
  describe('getSince', () => {
    it('returns snapshots since a timestamp', () => {
      const ts = Date.now();
      repo.create(makeMetrics({ timestamp: ts - 1000 }));
      repo.create(makeMetrics({ timestamp: ts + 1000 }));
      repo.create(makeMetrics({ timestamp: ts + 2000 }));

      const since = repo.getSince(ts);
      expect(since.length).toBe(2);
    });

    it('orders oldest to newest', () => {
      const ts = Date.now();
      repo.create(makeMetrics({ timestamp: ts + 2000 }));
      repo.create(makeMetrics({ timestamp: ts + 1000 }));

      const since = repo.getSince(ts);
      expect(since[0].timestamp).toBe(ts + 1000);
      expect(since[1].timestamp).toBe(ts + 2000);
    });
  });

  // ---------------------------------------------------------------------------
  // getRecentForTarget / getSinceForTarget
  // ---------------------------------------------------------------------------
  describe('target-specific queries', () => {
    it('getRecentForTarget returns only matching target snapshots', () => {
      repo.create(makeMetrics({ targetId: 'target-a' }));
      repo.create(makeMetrics({ targetId: 'target-b' }));
      repo.create(makeMetrics({ targetId: 'target-a' }));

      expect(repo.getRecentForTarget('target-a').length).toBe(2);
      expect(repo.getRecentForTarget('target-b').length).toBe(1);
    });

    it('getSinceForTarget filters by timestamp and target', () => {
      const ts = Date.now();
      repo.create(makeMetrics({ targetId: 'target-a', timestamp: ts - 1000 }));
      repo.create(makeMetrics({ targetId: 'target-a', timestamp: ts + 1000 }));
      repo.create(makeMetrics({ targetId: 'target-b', timestamp: ts + 1000 }));

      const since = repo.getSinceForTarget('target-a', ts);
      expect(since.length).toBe(1);
      expect(since[0].targetId).toBe('target-a');
    });
  });

  // ---------------------------------------------------------------------------
  // prune
  // ---------------------------------------------------------------------------
  describe('prune', () => {
    it('deletes old snapshots and returns count', () => {
      const now = Date.now();
      repo.create(makeMetrics({ timestamp: now - 20 * 60 * 1000 })); // 20 min ago
      repo.create(makeMetrics({ timestamp: now - 10 * 60 * 1000 })); // 10 min ago
      repo.create(makeMetrics({ timestamp: now }));                   // now

      const pruned = repo.prune(15 * 60 * 1000); // prune older than 15 min
      expect(pruned).toBe(1);
      expect(repo.count()).toBe(2);
    });

    it('returns 0 when nothing to prune', () => {
      repo.create(makeMetrics({ timestamp: Date.now() }));
      expect(repo.prune()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // count
  // ---------------------------------------------------------------------------
  describe('count', () => {
    it('returns total snapshot count', () => {
      expect(repo.count()).toBe(0);
      repo.create(makeMetrics());
      repo.create(makeMetrics());
      expect(repo.count()).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // mapMetricsSnapshot (model coverage)
  // ---------------------------------------------------------------------------
  describe('mapMetricsSnapshot', () => {
    it('maps all fields when present', () => {
      const row: DbMetricsRow = {
        id: 1,
        timestamp: 1000,
        cpu_percent: 50,
        mem_percent: 60,
        disk_percent: 70,
        net_up: 100,
        net_down: 200,
        target_id: 'target-1',
        el_min: 1, el_max: 100, el_mean: 50, el_p50: 45, el_p99: 95,
      };
      const snapshot = mapMetricsSnapshot(row);
      expect(snapshot.targetId).toBe('target-1');
      expect(snapshot.elMin).toBe(1);
      expect(snapshot.elP99).toBe(95);
    });

    it('excludes null optional fields', () => {
      const row: DbMetricsRow = {
        id: 1,
        timestamp: 1000,
        cpu_percent: 50,
        mem_percent: 60,
        disk_percent: 70,
        net_up: 100,
        net_down: 200,
        target_id: null,
        el_min: null, el_max: null, el_mean: null, el_p50: null, el_p99: null,
      };
      const snapshot = mapMetricsSnapshot(row);
      expect(snapshot.targetId).toBeUndefined();
      expect(snapshot.elMin).toBeUndefined();
      expect(snapshot.elP99).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Column migration
  // ---------------------------------------------------------------------------
  describe('column migration', () => {
    it('migrates missing el_* columns on construction', () => {
      // Create table with target_id but WITHOUT el_* columns
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-migrate-'));
      const dbPath = path.join(dir, 'test.db');
      const rawDb = new Database(dbPath);
      rawDb.pragma('journal_mode = WAL');
      rawDb.exec(`
        CREATE TABLE metrics_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          cpu_percent REAL NOT NULL,
          mem_percent REAL NOT NULL,
          disk_percent REAL NOT NULL,
          net_up REAL NOT NULL,
          net_down REAL NOT NULL,
          target_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics_snapshots(timestamp);
        CREATE INDEX IF NOT EXISTS idx_metrics_target_id ON metrics_snapshots(target_id, timestamp)
      `);

      // Constructor should add missing el_* columns
      const migratedRepo = new MetricsRepository(rawDb);
      migratedRepo.create({
        timestamp: Date.now(),
        cpuPercent: 50,
        memPercent: 60,
        diskPercent: 70,
        netUp: 100,
        netDown: 200,
        elMin: 1,
        elMax: 100,
        elMean: 50,
        elP50: 45,
        elP99: 95,
      });
      const recent = migratedRepo.getRecent(1);
      expect(recent[0].elMin).toBe(1);
      expect(recent[0].elP99).toBe(95);

      rawDb.close();
      try { fs.rmSync(dir, { recursive: true }); } catch { /* */ }
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('Performance', () => {
    it('1000 creates', () => {
      const count = 1000;
      const start = performance.now();
      const ts = Date.now();
      for (let i = 0; i < count; i++) {
        repo.create({
          timestamp: ts + i,
          cpuPercent: 50,
          memPercent: 60,
          diskPercent: 70,
          netUp: 1000,
          netDown: 2000,
        });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[metrics] create: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 reads', () => {
      for (let i = 0; i < 100; i++) {
        repo.create(makeMetrics());
      }
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.getRecent(50);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[metrics] getRecent: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });
  });
});
