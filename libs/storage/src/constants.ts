/**
 * Storage constants
 */

export const DB_FILENAME = 'agenshield.db';
export const ACTIVITY_DB_FILENAME = 'agenshield-activity.db';

/** Application ID for the activity database ("AGSA" in hex). */
export const ACTIVITY_APPLICATION_ID = 0x41475341;

export const META_KEYS = {
  PASSCODE_HASH: 'passcode_hash',
  ENCRYPTION_SALT: 'encryption_salt',
  PASSCODE_SET_AT: 'passcode_set_at',
  PASSCODE_CHANGED_AT: 'passcode_changed_at',
  PENDING_SECRETS_ENCRYPTION: 'pending_secrets_encryption',
  SKILLS_MIGRATED: 'skills_migrated',
  SECRETS_MIGRATED: 'secrets_migrated',
  SLUG_PREFIX_DISK_MIGRATED: 'slug_prefix_disk_migrated',
  CONFIG_MIGRATED_TO_DB: 'config_migrated_to_db',
  LEGACY_FILES_CLEANED: 'legacy_files_cleaned',
} as const;

export const DB_PRAGMAS = {
  JOURNAL_MODE: 'WAL',
  FOREIGN_KEYS: 'ON',
  BUSY_TIMEOUT: 5000,
} as const;

export const FILE_PERMISSIONS = {
  DB_FILE: 0o600,
  DB_DIR: 0o700,
} as const;

/** SQLite application_id for tamper detection ("AGSL" in hex). */
export const APPLICATION_ID = 0x4147534C;
