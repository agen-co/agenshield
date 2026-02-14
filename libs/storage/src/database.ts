/**
 * Database connection management
 *
 * Wraps better-sqlite3 with pragmas, file permissions, and lifecycle management.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DB_PRAGMAS, FILE_PERMISSIONS, APPLICATION_ID } from './constants';
import { DatabaseTamperError } from './errors';

/**
 * Open (or create) a SQLite database with proper pragmas and file permissions.
 * @param expectedAppId - Optional custom application_id (defaults to APPLICATION_ID for main DB).
 */
export function openDatabase(dbPath: string, expectedAppId: number = APPLICATION_ID): Database.Database {
  const dir = path.dirname(dbPath);

  // Ensure parent directory exists with restricted permissions
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: FILE_PERMISSIONS.DB_DIR });
  }

  const db = new Database(dbPath);

  // Set pragmas
  db.pragma(`journal_mode = ${DB_PRAGMAS.JOURNAL_MODE}`);
  db.pragma(`foreign_keys = ${DB_PRAGMAS.FOREIGN_KEYS}`);
  db.pragma(`busy_timeout = ${DB_PRAGMAS.BUSY_TIMEOUT}`);

  // Verify or set application_id for tamper detection
  const appId = db.pragma('application_id', { simple: true }) as number;
  if (appId === 0) {
    // Fresh database — stamp it
    db.pragma(`application_id = ${expectedAppId}`);
  } else if (appId !== expectedAppId) {
    db.close();
    throw new DatabaseTamperError(
      `Database application_id mismatch: expected 0x${expectedAppId.toString(16).toUpperCase()}, got 0x${appId.toString(16).toUpperCase()}. The file may have been replaced.`
    );
  }

  // Restrict file permissions
  try {
    fs.chmodSync(dbPath, FILE_PERMISSIONS.DB_FILE);
  } catch {
    // May fail on some systems (e.g. Windows) — non-fatal
  }

  return db;
}

/**
 * Close a database connection safely.
 */
export function closeDatabase(db: Database.Database): void {
  try {
    db.close();
  } catch {
    // Ignore close errors
  }
}
