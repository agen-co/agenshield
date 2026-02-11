/**
 * AgenShield Storage Library
 *
 * SQLite-based persistent storage with encryption, multi-tenancy, and migrations.
 *
 * @packageDocumentation
 */

// Core
export { Storage, initStorage, getStorage, closeStorage } from './storage';
export type { ScopedStorage } from './storage';

// Errors
export { StorageLockedError, StorageNotInitializedError, ValidationError, PasscodeError } from './errors';

// Constants
export { DB_FILENAME, META_KEYS } from './constants';

// Crypto
export { deriveKey, generateSalt, hashPasscode, verifyPasscode, encrypt, decrypt } from './crypto';

// Scoping
export { buildScopeWhere, getConfigScopeLevels, buildPolicyScopeWhere, mergeConfigRows, resolveSecretScope } from './scoping';

// Database
export { openDatabase, closeDatabase } from './database';

// Repositories
export { BaseRepository } from './repositories/base.repository';
export { ConfigRepository } from './repositories/config';
export type { ConfigData } from './repositories/config';
export { StateRepository } from './repositories/state';
export { VaultRepository } from './repositories/vault';
export type { VaultSecret, VaultKvEntry } from './repositories/vault';
export { PolicyRepository } from './repositories/policy';
export { ActivityRepository } from './repositories/activity';
export { SkillsRepository } from './repositories/skills';
export { CommandsRepository } from './repositories/commands';
export { TargetRepository } from './repositories/target';
export { PolicyGraphRepository } from './repositories/policy-graph';

// Migrations
export { runMigrations, getCurrentVersion, getDbVersion } from './migrations/index';
export type { Migration } from './migrations/types';
