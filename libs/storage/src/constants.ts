/**
 * Storage constants
 */

export const DB_FILENAME = 'agenshield.db';

export const META_KEYS = {
  PASSCODE_HASH: 'passcode_hash',
  ENCRYPTION_SALT: 'encryption_salt',
  PASSCODE_SET_AT: 'passcode_set_at',
  PASSCODE_CHANGED_AT: 'passcode_changed_at',
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
