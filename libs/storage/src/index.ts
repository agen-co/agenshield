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
export { StorageLockedError, StorageNotInitializedError, ValidationError, PasscodeError, DatabasePermissionError, DatabaseTamperError, DatabaseCorruptedError } from './errors';

// Constants
export { DB_FILENAME, ACTIVITY_DB_FILENAME, META_KEYS, APPLICATION_ID, ACTIVITY_APPLICATION_ID } from './constants';

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
export { PolicyRepository } from './repositories/policy';
export type { UpdatePolicyInput } from './repositories/policy';
export { ActivityRepository } from './repositories/activity';
export { SkillsRepository } from './repositories/skills';
export { CommandsRepository } from './repositories/commands';
export { ProfileRepository } from './repositories/profile';
export { PolicyGraphRepository } from './repositories/policy-graph';
export { SecretsRepository } from './repositories/secrets';
export type { CreateSecretInput, UpdateSecretInput } from './repositories/secrets';
export { AlertsRepository } from './repositories/alerts';
export type { AlertGetAllOptions, AlertCountOptions } from './repositories/alerts';
export { PolicySetRepository } from './repositories/policy-set';
export type { PolicySet, CreatePolicySetInput, UpdatePolicySetInput } from './repositories/policy-set';
export { MetricsRepository } from './repositories/metrics';
export type { MetricsSnapshot, MetricsSnapshotInput } from './repositories/metrics';
export { BinarySignatureRepository } from './repositories/binary-signature';
export type { CreateSignatureInput, UpsertBatchInput } from './repositories/binary-signature';
export { WorkspaceSkillsRepository } from './repositories/workspace-skills';
export type { CreateWorkspaceSkillInput, UpdateWorkspaceSkillInput } from './repositories/workspace-skills';
export { McpServerRepository } from './repositories/mcps';
export type { UpdateMcpServerInput } from './repositories/mcps';
export { CloudIdentityRepository } from './repositories/cloud-identity';
export type { CloudIdentity, SaveCloudIdentityInput } from './repositories/cloud-identity';
export { ApprovedSkillHashesRepository } from './repositories/approved-skill-hashes';
export type { ApprovedSkillHash } from './repositories/approved-skill-hashes';

// Vault key
export { loadOrCreateVaultKey, getVaultKey, getVaultKeyPath, clearVaultKeyCache } from './vault';

// Migrations
export { runMigrations, runActivityMigrations, getCurrentVersion, getDbVersion, validateDbIntegrity } from './migrations/index';
export type { Migration } from './migrations/types';
