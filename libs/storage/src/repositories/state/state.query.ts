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
} as const;
