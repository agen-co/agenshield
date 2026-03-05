import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { Storage, initStorage, getStorage, closeStorage } from '../storage';
import { StorageLockedError, StorageNotInitializedError, PasscodeError } from '../errors';
import { deriveKey, generateSalt } from '../crypto';
import { openDatabase } from '../database';
import { APPLICATION_ID, ACTIVITY_APPLICATION_ID } from '../constants';
import { runMigrations } from '../migrations/index';
import { runActivityMigrations } from '../migrations/activity/index';

function tmpDbPaths(): { dbPath: string; activityDbPath: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  return {
    dbPath: path.join(dir, 'test.db'),
    activityDbPath: path.join(dir, 'test-activity.db'),
    dir,
  };
}

describe('Storage', () => {
  let storage: Storage;
  let dbPath: string;
  let activityDbPath: string;
  let tmpDir: string;

  beforeEach(() => {
    const paths = tmpDbPaths();
    dbPath = paths.dbPath;
    activityDbPath = paths.activityDbPath;
    tmpDir = paths.dir;
    storage = Storage.open(dbPath, activityDbPath);
  });

  afterEach(() => {
    storage.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('creates the database file', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('has all repository properties', () => {
    expect(storage.config).toBeDefined();
    expect(storage.state).toBeDefined();
    expect(storage.secrets).toBeDefined();
    expect(storage.policies).toBeDefined();
    expect(storage.activities).toBeDefined();
    expect(storage.skills).toBeDefined();
    expect(storage.commands).toBeDefined();
    expect(storage.profiles).toBeDefined();
    expect(storage.policyGraph).toBeDefined();
  });

  describe('passcode management', () => {
    it('hasPasscode returns false initially', () => {
      expect(storage.hasPasscode()).toBe(false);
    });

    it('setPasscode sets and auto-unlocks', () => {
      storage.setPasscode('test123');
      expect(storage.hasPasscode()).toBe(true);
      expect(storage.isUnlocked()).toBe(true);
    });

    it('setPasscode throws if already set', () => {
      storage.setPasscode('test123');
      expect(() => storage.setPasscode('another')).toThrow(PasscodeError);
    });

    it('lock clears encryption key', () => {
      storage.setPasscode('test123');
      expect(storage.isUnlocked()).toBe(true);
      storage.lock();
      expect(storage.isUnlocked()).toBe(false);
    });

    it('unlock with correct passcode succeeds', () => {
      storage.setPasscode('test123');
      storage.lock();
      expect(storage.unlock('test123')).toBe(true);
      expect(storage.isUnlocked()).toBe(true);
    });

    it('unlock with wrong passcode fails', () => {
      storage.setPasscode('test123');
      storage.lock();
      expect(storage.unlock('wrong')).toBe(false);
      expect(storage.isUnlocked()).toBe(false);
    });

    it('unlock throws if no passcode set', () => {
      expect(() => storage.unlock('anything')).toThrow(PasscodeError);
    });

    it('unlockWithKey sets encryption key directly', () => {
      const key = deriveKey('test', generateSalt());
      storage.unlockWithKey(key);
      expect(storage.isUnlocked()).toBe(true);
    });

    it('initEncryption stores sentinel and sets key', () => {
      const key = deriveKey('test', generateSalt());
      storage.initEncryption(key);
      expect(storage.hasPasscode()).toBe(true);
      expect(storage.isUnlocked()).toBe(true);
    });

    it('changePasscode re-encrypts secrets', () => {
      storage.setPasscode('old-pass');
      // Create a secret while unlocked
      storage.secrets.create({ name: 'test-secret', value: 'secret-value' });

      storage.changePasscode('old-pass', 'new-pass');
      expect(storage.isUnlocked()).toBe(true);

      // Verify secret still decryptable with new key
      const secret = storage.secrets.getById(storage.secrets.getAll()[0].id);
      expect(secret!.value).toBe('secret-value');
    });

    it('changePasscode throws with wrong current passcode', () => {
      storage.setPasscode('correct');
      expect(() => storage.changePasscode('wrong', 'new')).toThrow(PasscodeError);
    });
  });

  describe('transaction', () => {
    it('commits on success', () => {
      storage.state.init('1.0.0');
      storage.transaction(() => {
        storage.state.updateVersion('2.0.0');
      });
      expect(storage.state.get()?.version).toBe('2.0.0');
    });

    it('rolls back on error', () => {
      storage.state.init('1.0.0');
      expect(() => {
        storage.transaction(() => {
          storage.state.updateVersion('2.0.0');
          throw new Error('rollback');
        });
      }).toThrow('rollback');
      expect(storage.state.get()?.version).toBe('1.0.0');
    });
  });

  describe('for(scope)', () => {
    it('returns ScopedStorage with all expected repos', () => {
      const scoped = storage.for({ profileId: 'test-profile' });
      expect(scoped.config).toBeDefined();
      expect(scoped.policies).toBeDefined();
      expect(scoped.secrets).toBeDefined();
      expect(scoped.activities).toBeDefined();
      expect(scoped.alerts).toBeDefined();
      expect(scoped.skills).toBeDefined();
      expect(scoped.policyGraph).toBeDefined();
      expect(scoped.policySets).toBeDefined();
    });
  });

  describe('getDb / getActivityDb', () => {
    it('returns database instances', () => {
      expect(storage.getDb()).toBeDefined();
      expect(storage.getActivityDb()).toBeDefined();
    });
  });

  describe('meta key-value', () => {
    it('getMeta returns null for missing key', () => {
      expect(storage.getMeta('nonexistent')).toBeNull();
    });

    it('setMeta and getMeta round-trip', () => {
      storage.setMeta('test-key', 'test-value');
      expect(storage.getMeta('test-key')).toBe('test-value');
    });

    it('setMeta overwrites existing value', () => {
      storage.setMeta('key', 'v1');
      storage.setMeta('key', 'v2');
      expect(storage.getMeta('key')).toBe('v2');
    });

    it('deleteMeta removes key', () => {
      storage.setMeta('key', 'value');
      storage.deleteMeta('key');
      expect(storage.getMeta('key')).toBeNull();
    });

    it('deleteMeta is safe for missing key', () => {
      expect(() => storage.deleteMeta('nonexistent')).not.toThrow();
    });
  });

  describe('dismissed targets', () => {
    it('getDismissedTargets returns empty initially', () => {
      expect(storage.getDismissedTargets()).toEqual([]);
    });

    it('dismissTarget adds a target', () => {
      storage.dismissTarget('target-1');
      expect(storage.getDismissedTargets()).toEqual(['target-1']);
    });

    it('dismissTarget is idempotent', () => {
      storage.dismissTarget('target-1');
      storage.dismissTarget('target-1');
      expect(storage.getDismissedTargets()).toEqual(['target-1']);
    });

    it('restoreTarget removes a dismissed target', () => {
      storage.dismissTarget('target-1');
      storage.dismissTarget('target-2');
      storage.restoreTarget('target-1');
      expect(storage.getDismissedTargets()).toEqual(['target-2']);
    });

    it('restoreTarget is safe for non-dismissed target', () => {
      expect(() => storage.restoreTarget('nonexistent')).not.toThrow();
    });
  });

  describe('additional repository properties', () => {
    it('has policySets, metrics, binarySignatures, workspaceSkills', () => {
      expect(storage.policySets).toBeDefined();
      expect(storage.metrics).toBeDefined();
      expect(storage.binarySignatures).toBeDefined();
      expect(storage.workspaceSkills).toBeDefined();
    });
  });
});

describe('Singleton management', () => {
  let dbPath: string;
  let activityDbPath: string;
  let tmpDir: string;

  beforeEach(() => {
    const paths = tmpDbPaths();
    dbPath = paths.dbPath;
    activityDbPath = paths.activityDbPath;
    tmpDir = paths.dir;
  });

  afterEach(() => {
    closeStorage();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('getStorage throws before init', () => {
    expect(() => getStorage()).toThrow(StorageNotInitializedError);
  });

  it('initStorage + getStorage works', () => {
    initStorage(dbPath, activityDbPath);
    const s = getStorage();
    expect(s).toBeInstanceOf(Storage);
  });

  it('closeStorage clears singleton', () => {
    initStorage(dbPath, activityDbPath);
    closeStorage();
    expect(() => getStorage()).toThrow(StorageNotInitializedError);
  });

  it('initStorage when instance already exists closes old and opens new', () => {
    const s1 = initStorage(dbPath, activityDbPath);
    expect(s1).toBeInstanceOf(Storage);

    // Create new paths for second init
    const paths2 = tmpDbPaths();
    const s2 = initStorage(paths2.dbPath, paths2.activityDbPath);
    expect(s2).toBeInstanceOf(Storage);
    expect(getStorage()).toBe(s2);

    // Cleanup second paths
    closeStorage();
    try { fs.rmSync(paths2.dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('closeStorage is safe when no instance exists', () => {
    expect(() => closeStorage()).not.toThrow();
  });
});

describe('migrateActivityData', () => {
  it('copies activity_events from main DB to activity DB', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
    const mainDbPath = path.join(dir, 'main.db');
    const activityDbPath = path.join(dir, 'activity.db');

    try {
      // Create and set up main DB with activity_events table
      const mainDb = openDatabase(mainDbPath);
      runMigrations(mainDb, null);

      // Manually create activity_events table in main DB (as it would have existed before split)
      mainDb.exec(`
        CREATE TABLE IF NOT EXISTS activity_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id TEXT,
          type TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Insert test data
      mainDb.prepare(
        'INSERT INTO activity_events (profile_id, type, timestamp, data, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(null, 'test.event', '2025-01-01T00:00:00Z', '{"key":"value"}', '2025-01-01T00:00:00Z');
      mainDb.prepare(
        'INSERT INTO activity_events (profile_id, type, timestamp, data, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('profile-1', 'test.event2', '2025-01-02T00:00:00Z', '{}', '2025-01-02T00:00:00Z');

      mainDb.close();

      // Open Storage which should trigger the migration
      const storage = Storage.open(mainDbPath, activityDbPath);

      // Verify activity DB has the migrated data
      const activities = storage.getActivityDb()
        .prepare('SELECT COUNT(*) as count FROM activity_events')
        .get() as { count: number };
      expect(activities.count).toBe(2);

      storage.close();
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('skips migration when activity DB already has data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-skip-'));
    const mainDbPath = path.join(dir, 'main.db');
    const activityDbPath = path.join(dir, 'activity.db');

    try {
      // Set up main DB with activity_events
      const mainDb = openDatabase(mainDbPath);
      runMigrations(mainDb, null);
      mainDb.exec(`
        CREATE TABLE IF NOT EXISTS activity_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id TEXT,
          type TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      mainDb.prepare(
        'INSERT INTO activity_events (profile_id, type, timestamp, data, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(null, 'old.event', '2025-01-01T00:00:00Z', '{}', '2025-01-01T00:00:00Z');
      mainDb.close();

      // Pre-populate activity DB
      const actDb = openDatabase(activityDbPath, ACTIVITY_APPLICATION_ID);
      runActivityMigrations(actDb);
      actDb.prepare(
        'INSERT INTO activity_events (profile_id, type, timestamp, data, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(null, 'existing.event', '2025-01-01T00:00:00Z', '{}', '2025-01-01T00:00:00Z');
      actDb.close();

      // Open Storage - should skip migration since activity DB already has data
      const storage = Storage.open(mainDbPath, activityDbPath);
      const activities = storage.getActivityDb()
        .prepare('SELECT COUNT(*) as count FROM activity_events')
        .get() as { count: number };
      expect(activities.count).toBe(1); // Only the existing event, not the migrated one

      storage.close();
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('skips migration when main DB has no activity_events rows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-empty-'));
    const mainDbPath = path.join(dir, 'main.db');
    const activityDbPath = path.join(dir, 'activity.db');

    try {
      // Set up main DB with empty activity_events table
      const mainDb = openDatabase(mainDbPath);
      runMigrations(mainDb, null);
      mainDb.exec(`
        CREATE TABLE IF NOT EXISTS activity_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id TEXT,
          type TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      mainDb.close();

      const storage = Storage.open(mainDbPath, activityDbPath);
      const activities = storage.getActivityDb()
        .prepare('SELECT COUNT(*) as count FROM activity_events')
        .get() as { count: number };
      expect(activities.count).toBe(0);

      storage.close();
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });
});
