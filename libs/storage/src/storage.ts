/**
 * Storage — Main entry point for the AgenShield storage layer
 *
 * Manages SQLite database lifecycle, passcode-based encryption,
 * and repository access.
 */

import type Database from 'better-sqlite3';
import type { ScopeFilter } from '@agenshield/ipc';
import { openDatabase, closeDatabase } from './database';
import { deriveKey, generateSalt, hashPasscode, verifyPasscode, encrypt as encryptValue, decrypt as decryptValue } from './crypto';
import { runMigrations } from './migrations/index';
import { META_KEYS } from './constants';
import { StorageLockedError, StorageNotInitializedError, PasscodeError } from './errors';
import { ConfigRepository } from './repositories/config';
import { StateRepository } from './repositories/state';
import { VaultRepository } from './repositories/vault';
import { PolicyRepository } from './repositories/policy';
import { ActivityRepository } from './repositories/activity';
import { SkillsRepository } from './repositories/skills';
import { CommandsRepository } from './repositories/commands';
import { TargetRepository } from './repositories/target';
import { PolicyGraphRepository } from './repositories/policy-graph';

export interface ScopedStorage {
  readonly config: ConfigRepository;
  readonly vault: VaultRepository;
  readonly policies: PolicyRepository;
  readonly activities: ActivityRepository;
  readonly skills: SkillsRepository;
  readonly policyGraph: PolicyGraphRepository;
}

const META = 'meta';
const VAULT_SECRETS = 'vault_secrets';
const VAULT_KV = 'vault_kv';

export class Storage {
  private db: Database.Database;
  private encryptionKey: Buffer | null = null;

  readonly config: ConfigRepository;
  readonly state: StateRepository;
  readonly vault: VaultRepository;
  readonly policies: PolicyRepository;
  readonly activities: ActivityRepository;
  readonly skills: SkillsRepository;
  readonly commands: CommandsRepository;
  readonly targets: TargetRepository;
  readonly policyGraph: PolicyGraphRepository;

  private constructor(db: Database.Database) {
    this.db = db;

    const getKey = () => this.encryptionKey;

    this.config = new ConfigRepository(db, getKey);
    this.state = new StateRepository(db, getKey);
    this.vault = new VaultRepository(db, getKey);
    this.policies = new PolicyRepository(db, getKey);
    this.activities = new ActivityRepository(db, getKey);
    this.skills = new SkillsRepository(db, getKey);
    this.commands = new CommandsRepository(db, getKey);
    this.targets = new TargetRepository(db, getKey);
    this.policyGraph = new PolicyGraphRepository(db, getKey);
  }

  /**
   * Open (or create) a storage database at the given path.
   * Runs migrations automatically.
   */
  static open(dbPath: string): Storage {
    const db = openDatabase(dbPath);
    const storage = new Storage(db);

    // Run migrations
    runMigrations(db, null);

    return storage;
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
   * Re-encrypts all vault data with the new key.
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
      // Re-encrypt vault secrets
      const secrets = this.db.prepare(`SELECT id, value_encrypted FROM ${VAULT_SECRETS}`).all() as Array<{ id: string; value_encrypted: string }>;
      const updateSecret = this.db.prepare(`UPDATE ${VAULT_SECRETS} SET value_encrypted = @value WHERE id = @id`);

      for (const secret of secrets) {
        const plaintext = decryptValue(secret.value_encrypted, oldKey);
        const reEncrypted = encryptValue(plaintext, newKey);
        updateSecret.run({ id: secret.id, value: reEncrypted });
      }

      // Re-encrypt vault KV
      const kvRows = this.db.prepare(`SELECT key, target_id, user_username, value_encrypted FROM ${VAULT_KV}`).all() as Array<{
        key: string; target_id: string | null; user_username: string | null; value_encrypted: string;
      }>;
      const updateKv = this.db.prepare(`UPDATE ${VAULT_KV} SET value_encrypted = @value WHERE key = @key AND target_id IS @targetId AND user_username IS @userUsername`);

      for (const kv of kvRows) {
        const plaintext = decryptValue(kv.value_encrypted, oldKey);
        const reEncrypted = encryptValue(plaintext, newKey);
        updateKv.run({ key: kv.key, targetId: kv.target_id, userUsername: kv.user_username, value: reEncrypted });
      }

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
      vault: new VaultRepository(this.db, getKey, scope),
      policies: new PolicyRepository(this.db, getKey, scope),
      activities: new ActivityRepository(this.db, getKey, scope),
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
   * Close the database connection.
   */
  close(): void {
    this.lock();
    closeDatabase(this.db);
  }

  /**
   * Get the underlying database (for testing/migrations only).
   */
  getDb(): Database.Database {
    return this.db;
  }
}

// ---- Singleton management ----

let instance: Storage | null = null;

/**
 * Initialize the global storage singleton.
 */
export function initStorage(dbPath: string): Storage {
  if (instance) {
    instance.close();
  }
  instance = Storage.open(dbPath);
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
