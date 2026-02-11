import Database from 'better-sqlite3';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runMigrations, getCurrentVersion } from '../migrations/index';
import type { Migration } from '../migrations/types';

function tmpDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('MigrationRunner', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = tmpDb();
  });

  afterEach(() => {
    db.close();
  });

  it('getCurrentVersion returns 0 for fresh DB', () => {
    expect(getCurrentVersion(db)).toBe(0);
  });

  it('runs a single migration', () => {
    const migration: Migration = {
      version: 1,
      name: 'test-001',
      up(db) {
        db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
      },
    };

    const count = runMigrations(db, null, [migration]);
    expect(count).toBe(1);
    expect(getCurrentVersion(db)).toBe(1);

    // Verify table was created
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'").get();
    expect(tables).toBeDefined();
  });

  it('skips already-applied migrations', () => {
    const migration: Migration = {
      version: 1,
      name: 'test-001',
      up(db) {
        db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
      },
    };

    runMigrations(db, null, [migration]);
    const count = runMigrations(db, null, [migration]);
    expect(count).toBe(0);
  });

  it('runs migrations in order', () => {
    const order: number[] = [];
    const migrations: Migration[] = [
      { version: 2, name: 'second', up() { order.push(2); } },
      { version: 1, name: 'first', up() { order.push(1); } },
      { version: 3, name: 'third', up() { order.push(3); } },
    ];

    runMigrations(db, null, migrations);
    expect(order).toEqual([1, 2, 3]);
    expect(getCurrentVersion(db)).toBe(3);
  });

  it('rolls back all on failure', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'ok', up(db) { db.exec('CREATE TABLE ok_table (id INTEGER PRIMARY KEY)'); } },
      { version: 2, name: 'fail', up() { throw new Error('migration failed'); } },
    ];

    expect(() => runMigrations(db, null, migrations)).toThrow('migration failed');
    expect(getCurrentVersion(db)).toBe(0);
  });
});
