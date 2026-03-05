import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { ActivitySchemaMigration } from '../../../migrations/activity/001-activity-schema';
import { AlertsTableMigration } from '../../../migrations/activity/002-alerts-table';
import { ActivitySourceMigration } from '../../../migrations/activity/003-activity-source';
import { AlertsRepository } from '../alerts.repository';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-test-'));
  const dbPath = path.join(dir, 'test-activity.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new ActivitySchemaMigration().up(db);
  new AlertsTableMigration().up(db);
  new ActivitySourceMigration().up(db);
  return {
    db,
    cleanup: () => {
      db.close();
      try { fs.rmSync(dir, { recursive: true }); } catch { /* */ }
    },
  };
}

let counter = 0;

/** Insert an activity_event row and return its id. */
function insertActivityEvent(db: Database.Database, profileId?: string): number {
  counter++;
  const result = db.prepare(
    'INSERT INTO activity_events (profile_id, type, timestamp, data, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(profileId ?? null, `type-${counter}`, new Date().toISOString(), '{}', new Date().toISOString());
  return Number(result.lastInsertRowid);
}

function makeAlert(db: Database.Database, overrides: Record<string, unknown> = {}) {
  counter++;
  const eventId = insertActivityEvent(db);
  return {
    activityEventId: eventId,
    eventType: `test.event.${counter}`,
    severity: 'warning',
    title: `Alert ${counter}`,
    description: `Description ${counter}`,
    navigationTarget: `/alerts/${counter}`,
    ...overrides,
  };
}

describe('AlertsRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: AlertsRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new AlertsRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('creates an alert and returns it', () => {
      const input = makeAlert(db);
      const alert = repo.create(input);
      expect(alert.id).toBeDefined();
      expect(typeof alert.id).toBe('number');
      expect(alert.title).toBe(input.title);
      expect(alert.severity).toBe('warning');
      expect(alert.createdAt).toBeDefined();
    });

    it('creates alert with details JSON', () => {
      const details = { key: 'value', nested: { a: 1 } };
      const alert = repo.create(makeAlert(db, { details }));
      expect(alert.details).toEqual(details);
    });

    it('creates alert without details', () => {
      const alert = repo.create(makeAlert(db));
      expect(alert.details).toBeUndefined();
    });

    it('creates alert with profileId', () => {
      const alert = repo.create(makeAlert(db, { profileId: 'profile-1' }));
      expect(alert.profileId).toBe('profile-1');
    });
  });

  // ---------------------------------------------------------------------------
  // getById
  // ---------------------------------------------------------------------------
  describe('getById', () => {
    it('returns alert by ID', () => {
      const created = repo.create(makeAlert(db));
      const found = repo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe(created.title);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById(99999)).toBeNull();
    });

    it('round-trips details JSON through getById', () => {
      const details = { foo: [1, 2, 3] };
      const created = repo.create(makeAlert(db, { details }));
      const found = repo.getById(created.id);
      expect(found!.details).toEqual(details);
    });
  });

  // ---------------------------------------------------------------------------
  // getAll
  // ---------------------------------------------------------------------------
  describe('getAll', () => {
    it('returns all unacknowledged alerts by default', () => {
      repo.create(makeAlert(db));
      repo.create(makeAlert(db));
      const a3 = repo.create(makeAlert(db));
      repo.acknowledge(a3.id);

      const all = repo.getAll();
      expect(all.length).toBe(2);
    });

    it('includes acknowledged when requested', () => {
      repo.create(makeAlert(db));
      const a2 = repo.create(makeAlert(db));
      repo.acknowledge(a2.id);

      const all = repo.getAll({ includeAcknowledged: true });
      expect(all.length).toBe(2);
    });

    it('filters by severity', () => {
      repo.create(makeAlert(db, { severity: 'critical' }));
      repo.create(makeAlert(db, { severity: 'warning' }));
      repo.create(makeAlert(db, { severity: 'info' }));

      const critical = repo.getAll({ severity: 'critical' });
      expect(critical.length).toBe(1);
      expect(critical[0].severity).toBe('critical');
    });

    it('paginates with limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        repo.create(makeAlert(db));
      }

      const page1 = repo.getAll({ limit: 2, offset: 0 });
      expect(page1.length).toBe(2);

      const page2 = repo.getAll({ limit: 2, offset: 2 });
      expect(page2.length).toBe(2);

      const page3 = repo.getAll({ limit: 2, offset: 4 });
      expect(page3.length).toBe(1);
    });

    it('returns empty array when no alerts', () => {
      expect(repo.getAll()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // count
  // ---------------------------------------------------------------------------
  describe('count', () => {
    it('counts unacknowledged alerts by default', () => {
      repo.create(makeAlert(db));
      repo.create(makeAlert(db));
      const a3 = repo.create(makeAlert(db));
      repo.acknowledge(a3.id);

      expect(repo.count()).toBe(2);
    });

    it('counts all when includeAcknowledged', () => {
      repo.create(makeAlert(db));
      const a2 = repo.create(makeAlert(db));
      repo.acknowledge(a2.id);

      expect(repo.count({ includeAcknowledged: true })).toBe(2);
    });

    it('counts by severity', () => {
      repo.create(makeAlert(db, { severity: 'critical' }));
      repo.create(makeAlert(db, { severity: 'warning' }));
      repo.create(makeAlert(db, { severity: 'warning' }));

      expect(repo.count({ severity: 'warning' })).toBe(2);
      expect(repo.count({ severity: 'critical' })).toBe(1);
    });

    it('returns 0 when no alerts', () => {
      expect(repo.count()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // acknowledge
  // ---------------------------------------------------------------------------
  describe('acknowledge', () => {
    it('acknowledges an alert', () => {
      const alert = repo.create(makeAlert(db));
      expect(repo.acknowledge(alert.id)).toBe(true);

      const found = repo.getById(alert.id);
      expect(found!.acknowledgedAt).toBeDefined();
    });

    it('is idempotent (second acknowledge returns false)', () => {
      const alert = repo.create(makeAlert(db));
      expect(repo.acknowledge(alert.id)).toBe(true);
      expect(repo.acknowledge(alert.id)).toBe(false);
    });

    it('returns false for non-existent alert', () => {
      expect(repo.acknowledge(99999)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // acknowledgeAll
  // ---------------------------------------------------------------------------
  describe('acknowledgeAll', () => {
    it('acknowledges all unacknowledged alerts and returns count', () => {
      repo.create(makeAlert(db));
      repo.create(makeAlert(db));
      repo.create(makeAlert(db));

      const count = repo.acknowledgeAll();
      expect(count).toBe(3);
      expect(repo.count()).toBe(0);
    });

    it('returns 0 when all already acknowledged', () => {
      const a = repo.create(makeAlert(db));
      repo.acknowledge(a.id);
      expect(repo.acknowledgeAll()).toBe(0);
    });

    it('returns 0 when no alerts exist', () => {
      expect(repo.acknowledgeAll()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // clear
  // ---------------------------------------------------------------------------
  describe('clear', () => {
    it('deletes all alerts and returns count', () => {
      repo.create(makeAlert(db));
      repo.create(makeAlert(db));

      const count = repo.clear();
      expect(count).toBe(2);
      expect(repo.count({ includeAcknowledged: true })).toBe(0);
    });

    it('returns 0 when no alerts', () => {
      expect(repo.clear()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('Performance', () => {
    it('1000 creates', () => {
      // Pre-create activity events
      const eventIds: number[] = [];
      for (let i = 0; i < 1000; i++) {
        eventIds.push(insertActivityEvent(db));
      }

      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.create({
          activityEventId: eventIds[i],
          eventType: 'test.event',
          severity: 'warning',
          title: `Alert ${i}`,
          description: `Description ${i}`,
          navigationTarget: `/alerts/${i}`,
        });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[alerts] create: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 reads', () => {
      for (let i = 0; i < 10; i++) {
        repo.create(makeAlert(db));
      }

      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.getAll({ limit: 10 });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[alerts] getAll: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });
  });
});
