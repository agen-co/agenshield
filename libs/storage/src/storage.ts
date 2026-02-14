/**
 * Storage — Main entry point for the AgenShield storage layer
 *
 * Manages two SQLite databases:
 * - Main DB: config, state, policies, skills, secrets, commands, profiles
 * - Activity DB: high-write activity_events (separated to reduce WAL contention)
 *
 * Manages passcode-based encryption and repository access.
 */

import type Database from 'better-sqlite3';
import type { ScopeFilter } from '@agenshield/ipc';
import { openDatabase, closeDatabase } from './database';
import { deriveKey, generateSalt, hashPasscode, verifyPasscode, encrypt as encryptValue, decrypt as decryptValue } from './crypto';
import { runMigrations, runActivityMigrations } from './migrations/index';
import { META_KEYS } from './constants';
import { ACTIVITY_APPLICATION_ID } from './constants';
import { StorageLockedError, StorageNotInitializedError, PasscodeError } from './errors';
import { ConfigRepository } from './repositories/config';
import { StateRepository } from './repositories/state';
import { PolicyRepository } from './repositories/policy';
import { ActivityRepository } from './repositories/activity';
import { SkillsRepository } from './repositories/skills';
import { CommandsRepository } from './repositories/commands';
import { ProfileRepository } from './repositories/profile';
import { PolicyGraphRepository } from './repositories/policy-graph';
import { SecretsRepository } from './repositories/secrets';

export interface ScopedStorage {
  readonly config: ConfigRepository;
  readonly policies: PolicyRepository;
  readonly secrets: SecretsRepository;
  readonly activities: ActivityRepository;
  readonly skills: SkillsRepository;
  readonly policyGraph: PolicyGraphRepository;
}

const META = 'meta';
const SECRETS = 'secrets';

export class Storage {
  private db: Database.Database;
  private activityDb: Database.Database;
  private encryptionKey: Buffer | null = null;

  readonly config: ConfigRepository;
  readonly state: StateRepository;
  readonly policies: PolicyRepository;
  readonly activities: ActivityRepository;
  readonly skills: SkillsRepository;
  readonly commands: CommandsRepository;
  readonly profiles: ProfileRepository;
  readonly policyGraph: PolicyGraphRepository;
  readonly secrets: SecretsRepository;

  private constructor(db: Database.Database, activityDb: Database.Database) {
    this.db = db;
    this.activityDb = activityDb;

    const getKey = () => this.encryptionKey;

    this.config = new ConfigRepository(db, getKey);
    this.state = new StateRepository(db, getKey);
    this.policies = new PolicyRepository(db, getKey);
    // Activity uses the separate activity database
    this.activities = new ActivityRepository(activityDb, getKey);
    this.skills = new SkillsRepository(db, getKey);
    this.commands = new CommandsRepository(db, getKey);
    this.profiles = new ProfileRepository(db, getKey);
    this.policyGraph = new PolicyGraphRepository(db, getKey);
    this.secrets = new SecretsRepository(db, getKey);
  }

  /**
   * Open (or create) main + activity databases at the given paths.
   * Copies activity_events from main → activity DB if present, then runs migrations.
   */
  static open(dbPath: string, activityDbPath: string): Storage {
    const db = openDatabase(dbPath);
    const activityDb = openDatabase(activityDbPath, ACTIVITY_APPLICATION_ID);

    // Run activity DB migrations first
    runActivityMigrations(activityDb);

    // Copy activity_events from main DB to activity DB before migration drops the table
    Storage.migrateActivityData(db, activityDb);

    // Run main DB migrations
    runMigrations(db, null);

    return new Storage(db, activityDb);
  }

  /**
   * Copy activity_events rows from main DB to activity DB (one-time migration).
   * Only runs if the main DB still has the activity_events table.
   */
  private static migrateActivityData(
    mainDb: Database.Database,
    activityDb: Database.Database,
  ): void {
    // Check if main DB still has the activity_events table
    const tableExists = mainDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_events'")
      .get();
    if (!tableExists) return;

    // Check if activity DB already has data (don't duplicate)
    const activityCount = activityDb
      .prepare('SELECT COUNT(*) as count FROM activity_events')
      .get() as { count: number };
    if (activityCount.count > 0) return;

    // Copy rows from main → activity
    const rows = mainDb.prepare('SELECT * FROM activity_events ORDER BY id').all() as Array<{
      id: number; profile_id: string | null; type: string; timestamp: string; data: string; created_at: string;
    }>;

    if (rows.length === 0) return;

    const insert = activityDb.prepare(
      'INSERT INTO activity_events (profile_id, type, timestamp, data, created_at) VALUES (@profile_id, @type, @timestamp, @data, @created_at)',
    );

    activityDb.transaction(() => {
      for (const row of rows) {
        insert.run({
          profile_id: row.profile_id,
          type: row.type,
          timestamp: row.timestamp,
          data: row.data,
          created_at: row.created_at,
        });
      }
    })();

    console.log(`[Storage] Migrated ${rows.length} activity events to activity DB`);
  }

  /**
   * Check if a passcode has been set.
   */
  hasPasscode(): boolean {
    const row = this.db.prepare(`SELECT value FROM ${META} WHERE key = ?`)
      .get(META_KEYS.PASSCODE_HASH) as { value: string } | undefined;
    return !!row;
  }

  /**
   * Set a new passcode (first-time setup). Throws if passcode already set.
   */
  setPasscode(passcode: string): void {
    if (this.hasPasscode()) {
      throw new PasscodeError('Passcode already set. Use changePasscode() instead.');
    }

    const salt = generateSalt();
    const hash = hashPasscode(passcode, salt);
    const now = new Date().toISOString();

    const upsertMeta = this.db.prepare(
      `INSERT OR REPLACE INTO ${META} (key, value) VALUES (@key, @value)`,
    );

    this.db.transaction(() => {
      upsertMeta.run({ key: META_KEYS.ENCRYPTION_SALT, value: salt.toString('hex') });
      upsertMeta.run({ key: META_KEYS.PASSCODE_HASH, value: hash });
      upsertMeta.run({ key: META_KEYS.PASSCODE_SET_AT, value: now });
    })();

    // Auto-unlock after setting
    this.encryptionKey = deriveKey(passcode, salt);
  }

  /**
   * Unlock the vault with a passcode. Returns true if successful.
   */
  unlock(passcode: string): boolean {
    const saltRow = this.db.prepare(`SELECT value FROM ${META} WHERE key = ?`)
      .get(META_KEYS.ENCRYPTION_SALT) as { value: string } | undefined;
    const hashRow = this.db.prepare(`SELECT value FROM ${META} WHERE key = ?`)
      .get(META_KEYS.PASSCODE_HASH) as { value: string } | undefined;

    if (!saltRow || !hashRow) {
      throw new PasscodeError('No passcode has been set.');
    }

    const salt = Buffer.from(saltRow.value, 'hex');
    if (!verifyPasscode(passcode, salt, hashRow.value)) {
      return false;
    }

    this.encryptionKey = deriveKey(passcode, salt);
    return true;
  }

  /**
   * Lock the vault (clear encryption key from memory).
   */
  lock(): void {
    if (this.encryptionKey) {
      this.encryptionKey.fill(0);
    }
    this.encryptionKey = null;
  }

  /**
   * Check if the vault is currently unlocked.
   */
  isUnlocked(): boolean {
    return this.encryptionKey !== null;
  }

  /**
   * Change the passcode. Requires current passcode to be correct.
   * Re-encrypts all secrets with the new key.
   */
  changePasscode(currentPasscode: string, newPasscode: string): void {
    if (!this.unlock(currentPasscode)) {
      throw new PasscodeError('Current passcode is incorrect.');
    }

    const oldKey = this.encryptionKey!;
    const newSalt = generateSalt();
    const newHash = hashPasscode(newPasscode, newSalt);
    const newKey = deriveKey(newPasscode, newSalt);
    const now = new Date().toISOString();

    this.db.transaction(() => {
      // Re-encrypt secrets table
      this.reEncryptSecrets(oldKey, newKey);

      // Update meta
      const upsertMeta = this.db.prepare(
        `INSERT OR REPLACE INTO ${META} (key, value) VALUES (@key, @value)`,
      );
      upsertMeta.run({ key: META_KEYS.ENCRYPTION_SALT, value: newSalt.toString('hex') });
      upsertMeta.run({ key: META_KEYS.PASSCODE_HASH, value: newHash });
      upsertMeta.run({ key: META_KEYS.PASSCODE_CHANGED_AT, value: now });
    })();

    // Clear old key, set new one
    oldKey.fill(0);
    this.encryptionKey = newKey;
  }

  /**
   * Create a scoped view of storage for a specific target/user.
   * Returns repositories pre-bound to the given scope.
   */
  for(scope: ScopeFilter): ScopedStorage {
    const getKey = () => this.encryptionKey;
    return {
      config: new ConfigRepository(this.db, getKey, scope),
      policies: new PolicyRepository(this.db, getKey, scope),
      secrets: new SecretsRepository(this.db, getKey, scope),
      activities: new ActivityRepository(this.activityDb, getKey, scope),
      skills: new SkillsRepository(this.db, getKey, scope),
      policyGraph: new PolicyGraphRepository(this.db, getKey, scope),
    };
  }

  /**
   * Run a function in a transaction.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Close both database connections.
   */
  close(): void {
    this.lock();
    closeDatabase(this.activityDb);
    closeDatabase(this.db);
  }

  /**
   * Get the underlying main database (for testing/migrations only).
   */
  getDb(): Database.Database {
    return this.db;
  }

  /**
   * Get the underlying activity database (for testing only).
   */
  getActivityDb(): Database.Database {
    return this.activityDb;
  }

  /**
   * Get or set a meta key-value pair.
   */
  getMeta(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM ${META} WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO ${META} (key, value) VALUES (@key, @value)`).run({ key, value });
  }

  deleteMeta(key: string): void {
    this.db.prepare(`DELETE FROM ${META} WHERE key = ?`).run(key);
  }

  /**
   * Re-encrypt secrets table values with a new key (called during changePasscode).
   */
  private reEncryptSecrets(oldKey: Buffer, newKey: Buffer): void {
    const rows = this.db.prepare(
      `SELECT id, value_encrypted FROM ${SECRETS} WHERE value_encrypted IS NOT NULL`,
    ).all() as Array<{ id: string; value_encrypted: string }>;

    const update = this.db.prepare(`UPDATE ${SECRETS} SET value_encrypted = @value WHERE id = @id`);

    for (const row of rows) {
      const plaintext = decryptValue(row.value_encrypted, oldKey);
      const reEncrypted = encryptValue(plaintext, newKey);
      update.run({ id: row.id, value: reEncrypted });
    }
  }
}

// ---- Singleton management ----

let instance: Storage | null = null;

/**
 * Initialize the global storage singleton with dual databases.
 */
export function initStorage(dbPath: string, activityDbPath: string): Storage {
  if (instance) {
    instance.close();
  }
  instance = Storage.open(dbPath, activityDbPath);
  return instance;
}

/**
 * Get the global storage singleton. Throws if not initialized.
 */
export function getStorage(): Storage {
  if (!instance) {
    throw new StorageNotInitializedError();
  }
  return instance;
}

/**
 * Close and clear the global storage singleton.
 */
export function closeStorage(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
