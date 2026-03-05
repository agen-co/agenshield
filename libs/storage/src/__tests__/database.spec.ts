import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../database';
import { APPLICATION_ID } from '../constants';
import { DatabaseTamperError } from '../errors';

describe('openDatabase', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('creates a new database and stamps application_id', () => {
    const dbPath = path.join(tmpDir, 'fresh.db');
    const db = openDatabase(dbPath);

    expect(fs.existsSync(dbPath)).toBe(true);
    const appId = db.pragma('application_id', { simple: true }) as number;
    expect(appId).toBe(APPLICATION_ID);

    db.close();
  });

  it('opens an existing database with matching application_id', () => {
    const dbPath = path.join(tmpDir, 'existing.db');

    // Create and stamp
    const db1 = openDatabase(dbPath);
    db1.close();

    // Re-open should succeed
    const db2 = openDatabase(dbPath);
    const appId = db2.pragma('application_id', { simple: true }) as number;
    expect(appId).toBe(APPLICATION_ID);
    db2.close();
  });

  it('throws DatabaseTamperError for mismatched application_id', () => {
    const dbPath = path.join(tmpDir, 'tampered.db');

    // Create with a different app ID
    const raw = new Database(dbPath);
    raw.pragma('application_id = 12345');
    raw.close();

    expect(() => openDatabase(dbPath)).toThrow(DatabaseTamperError);
  });

  it('sets WAL journal mode', () => {
    const dbPath = path.join(tmpDir, 'wal.db');
    const db = openDatabase(dbPath);
    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
    db.close();
  });

  it('enables foreign keys', () => {
    const dbPath = path.join(tmpDir, 'fk.db');
    const db = openDatabase(dbPath);
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
    db.close();
  });

  it('creates parent directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'nested', 'dir', 'test.db');
    const db = openDatabase(nested);
    expect(fs.existsSync(nested)).toBe(true);
    db.close();
  });

  it('accepts custom application_id', () => {
    const dbPath = path.join(tmpDir, 'custom.db');
    const customId = 0x41475341; // ACTIVITY_APPLICATION_ID
    const db = openDatabase(dbPath, customId);
    const appId = db.pragma('application_id', { simple: true }) as number;
    expect(appId).toBe(customId);
    db.close();
  });
});

describe('closeDatabase', () => {
  it('closes a database connection', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-close-'));
    const dbPath = path.join(tmpDir, 'close.db');
    const db = openDatabase(dbPath);

    expect(() => closeDatabase(db)).not.toThrow();

    // Verify DB is closed by trying to use it
    expect(() => db.prepare('SELECT 1')).toThrow();

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('handles already-closed DB gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-close2-'));
    const dbPath = path.join(tmpDir, 'close2.db');
    const db = openDatabase(dbPath);
    db.close();

    // Should not throw
    expect(() => closeDatabase(db)).not.toThrow();

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });
});
