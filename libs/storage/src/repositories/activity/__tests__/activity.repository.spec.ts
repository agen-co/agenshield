/**
 * ActivityRepository tests
 *
 * Covers: append, getAll, count, clear, pruning, redaction, and performance.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../migrations/001-initial-schema';
import { ActivityRepository } from '../activity.repository';

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

// ActivityRepository does not use encryption
const getKey = () => null;

/**
 * Insert parent target rows required by foreign key constraints.
 * activity_events reference targets(id).
 */
function seedScopeFixtures(db: Database.Database): void {
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-1', 'Target One');
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-a', 'Target A');
  db.prepare(
    `INSERT INTO targets (id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`,
  ).run('target-b', 'Target B');
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'policy_check',
    timestamp: new Date().toISOString(),
    data: { command: 'node index.js', result: 'allowed' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ActivityRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: ActivityRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new ActivityRepository(db, getKey);
  });

  afterEach(() => cleanup());

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  describe('CRUD', () => {
    it('should append an event and return it', () => {
      const event = repo.append(makeEvent());

      expect(event.id).toBeDefined();
      expect(typeof event.id).toBe('number');
      expect(event.type).toBe('policy_check');
      expect(event.data).toBeDefined();
      expect(event.createdAt).toBeDefined();
    });

    it('should append an event with a targetId', () => {
      seedScopeFixtures(db);
      const event = repo.append(makeEvent({ targetId: 'target-1' }));
      expect(event.targetId).toBe('target-1');
    });

    it('should retrieve all events with default pagination', () => {
      repo.append(makeEvent({ timestamp: '2025-01-01T00:00:00.000Z' }));
      repo.append(makeEvent({ timestamp: '2025-01-02T00:00:00.000Z' }));
      repo.append(makeEvent({ timestamp: '2025-01-03T00:00:00.000Z' }));

      const all = repo.getAll();
      expect(all).toHaveLength(3);
      // Should be ordered by timestamp DESC
      expect(all[0].timestamp).toBe('2025-01-03T00:00:00.000Z');
      expect(all[2].timestamp).toBe('2025-01-01T00:00:00.000Z');
    });

    it('should filter events by type', () => {
      repo.append(makeEvent({ type: 'policy_check' }));
      repo.append(makeEvent({ type: 'skill_install' }));
      repo.append(makeEvent({ type: 'policy_check' }));

      const filtered = repo.getAll({ type: 'policy_check' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.type === 'policy_check')).toBe(true);
    });

    it('should filter events by targetId', () => {
      seedScopeFixtures(db);
      repo.append(makeEvent({ targetId: 'target-a' }));
      repo.append(makeEvent({ targetId: 'target-b' }));
      repo.append(makeEvent({ targetId: 'target-a' }));

      const filtered = repo.getAll({ targetId: 'target-a' });
      expect(filtered).toHaveLength(2);
    });

    it('should filter events by since timestamp', () => {
      repo.append(makeEvent({ timestamp: '2025-01-01T00:00:00.000Z' }));
      repo.append(makeEvent({ timestamp: '2025-06-01T00:00:00.000Z' }));
      repo.append(makeEvent({ timestamp: '2025-12-01T00:00:00.000Z' }));

      const filtered = repo.getAll({ since: '2025-06-01T00:00:00.000Z' });
      expect(filtered).toHaveLength(2);
    });

    it('should support pagination with limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        repo.append(makeEvent({ timestamp: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }));
      }

      const page1 = repo.getAll({ limit: 3, offset: 0 });
      expect(page1).toHaveLength(3);

      const page2 = repo.getAll({ limit: 3, offset: 3 });
      expect(page2).toHaveLength(3);

      // No overlap between pages
      const page1Ids = page1.map((e) => e.id);
      const page2Ids = page2.map((e) => e.id);
      expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);
    });

    it('should count all events', () => {
      expect(repo.count()).toBe(0);
      repo.append(makeEvent());
      repo.append(makeEvent());
      expect(repo.count()).toBe(2);
    });

    it('should count events filtered by type', () => {
      repo.append(makeEvent({ type: 'exec' }));
      repo.append(makeEvent({ type: 'exec' }));
      repo.append(makeEvent({ type: 'policy_check' }));

      expect(repo.count({ type: 'exec' })).toBe(2);
      expect(repo.count({ type: 'policy_check' })).toBe(1);
    });

    it('should count events filtered by targetId', () => {
      seedScopeFixtures(db);
      repo.append(makeEvent({ targetId: 'target-a' }));
      repo.append(makeEvent({ targetId: 'target-b' }));

      expect(repo.count({ targetId: 'target-a' })).toBe(1);
    });

    it('should clear all events', () => {
      repo.append(makeEvent());
      repo.append(makeEvent());
      repo.append(makeEvent());

      const deleted = repo.clear();
      expect(deleted).toBe(3);
      expect(repo.count()).toBe(0);
    });

    it('should return 0 when clearing an empty table', () => {
      expect(repo.clear()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Pruning
  // -----------------------------------------------------------------------

  describe('Pruning', () => {
    it('should prune oldest events to keep at most maxEvents', () => {
      // Insert 20 events with ascending timestamps
      for (let i = 0; i < 20; i++) {
        repo.append(makeEvent({
          timestamp: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
          data: { index: i },
        }));
      }

      expect(repo.count()).toBe(20);

      const pruned = repo.prune(10);
      expect(pruned).toBe(10);
      expect(repo.count()).toBe(10);

      // The remaining events should be the newest ones
      const remaining = repo.getAll({ limit: 100 });
      const timestamps = remaining.map((e) => e.timestamp);
      // All remaining timestamps should be >= Jan 11
      for (const ts of timestamps) {
        expect(ts >= '2025-01-11T00:00:00.000Z').toBe(true);
      }
    });

    it('should return 0 when total events are within the limit', () => {
      repo.append(makeEvent());
      repo.append(makeEvent());

      expect(repo.prune(10)).toBe(0);
      expect(repo.count()).toBe(2);
    });

    it('should return 0 when the table is empty', () => {
      expect(repo.prune(100)).toBe(0);
    });

    it('should prune down to exactly maxEvents', () => {
      // Use Date arithmetic to generate valid ISO timestamps
      const base = new Date('2025-03-01T00:00:00.000Z');
      for (let i = 0; i < 50; i++) {
        const ts = new Date(base.getTime() + i * 60_000); // 1 minute apart
        repo.append(makeEvent({ timestamp: ts.toISOString() }));
      }

      repo.prune(25);
      expect(repo.count()).toBe(25);
    });
  });

  // -----------------------------------------------------------------------
  // Redaction
  // -----------------------------------------------------------------------

  describe('Redaction', () => {
    it('should redact sensitive fields in event data', () => {
      const event = repo.append(makeEvent({
        data: {
          command: 'curl api.example.com',
          password: 'super-secret',
          token: 'jwt-token-value',
          secret: 'my-secret',
          key: 'api-key-123',
          value: 'should-be-redacted',
          result: 'allowed',
        },
      }));

      expect(event.data).toBeDefined();
      const data = event.data as Record<string, unknown>;
      expect(data.command).toBe('curl api.example.com');
      expect(data.result).toBe('allowed');
      expect(data.password).toBe('[REDACTED]');
      expect(data.token).toBe('[REDACTED]');
      expect(data.secret).toBe('[REDACTED]');
      expect(data.key).toBe('[REDACTED]');
      expect(data.value).toBe('[REDACTED]');
    });

    it('should redact nested sensitive fields', () => {
      const event = repo.append(makeEvent({
        data: {
          outer: {
            password: 'nested-password',
            safe: 'visible',
          },
        },
      }));

      const data = event.data as Record<string, Record<string, unknown>>;
      expect(data.outer.password).toBe('[REDACTED]');
      expect(data.outer.safe).toBe('visible');
    });

    it('should redact fields in arrays', () => {
      const event = repo.append(makeEvent({
        data: [
          { name: 'item1', secret: 'hidden' },
          { name: 'item2', token: 'hidden' },
        ],
      }));

      const data = event.data as Array<Record<string, unknown>>;
      expect(data[0].name).toBe('item1');
      expect(data[0].secret).toBe('[REDACTED]');
      expect(data[1].token).toBe('[REDACTED]');
    });

    it('should persist redacted data in the database', () => {
      repo.append(makeEvent({
        data: { password: 'should-not-persist', safe: 'ok' },
      }));

      // Read raw from DB
      const row = db.prepare('SELECT data FROM activity_events LIMIT 1').get() as { data: string };
      const parsed = JSON.parse(row.data);
      expect(parsed.password).toBe('[REDACTED]');
      expect(parsed.safe).toBe('ok');
    });

    it('should handle null/undefined data gracefully', () => {
      const event = repo.append(makeEvent({ data: null }));
      expect(event.data).toBeNull();
    });

    it('should handle primitive data', () => {
      const event = repo.append(makeEvent({ data: 'just a string' }));
      expect(event.data).toBe('just a string');
    });
  });

  // -----------------------------------------------------------------------
  // Performance
  // -----------------------------------------------------------------------

  describe('Performance', () => {
    it('should append 1000 events efficiently', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        repo.append({
          type: 'policy_check',
          timestamp: new Date(Date.now() + i).toISOString(),
          data: { index: i, command: `cmd-${i}` },
        });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round(1000 / (elapsed / 1000));

      expect(repo.count()).toBe(1000);
      // Expect at least 200 ops/sec
      expect(opsPerSec).toBeGreaterThan(200);
    });

    it('should getAll 1000 events efficiently', () => {
      for (let i = 0; i < 1000; i++) {
        repo.append({
          type: 'exec',
          timestamp: new Date(Date.now() + i).toISOString(),
          data: { i },
        });
      }

      const start = performance.now();
      const all = repo.getAll({ limit: 1000 });
      const elapsed = performance.now() - start;

      expect(all).toHaveLength(1000);
      // Should complete in under 1 second
      expect(elapsed).toBeLessThan(1000);
    });
  });
});
