/**
 * State SQL queries
 */

const TABLE = 'state';

export const Q = {
  selectById: `SELECT * FROM ${TABLE} WHERE id = 1`,

  insert: `
    INSERT OR IGNORE INTO ${TABLE} (id, version, installed_at)
    VALUES (1, @version, @installedAt)`,

  updateVersion: `
    UPDATE ${TABLE} SET version = @version, updated_at = @updatedAt
    WHERE id = 1`,

  // ── Users ──────────────────────────────────────────

  selectAllUsers: `SELECT * FROM users ORDER BY username`,

  upsertUser: `
    INSERT OR REPLACE INTO users (username, uid, type, created_at, home_dir)
    VALUES (@username, @uid, @type, @createdAt, @homeDir)`,

  deleteUser: `DELETE FROM users WHERE username = @username`,

  deleteAllUsers: `DELETE FROM users`,

  // ── Groups ─────────────────────────────────────────

  selectAllGroups: `SELECT * FROM groups_ ORDER BY name`,

  upsertGroup: `
    INSERT OR REPLACE INTO groups_ (name, gid, type)
    VALUES (@name, @gid, @type)`,

  deleteGroup: `DELETE FROM groups_ WHERE name = @name`,

  deleteAllGroups: `DELETE FROM groups_`,
} as const;
