/**
 * Activity SQL queries
 */

const TABLE = 'activity_events';

export const Q = {
  insert: `
    INSERT INTO ${TABLE} (profile_id, type, timestamp, data, created_at)
    VALUES (@profileId, @type, @timestamp, @data, @createdAt)`,

  deleteAll: `DELETE FROM ${TABLE}`,

  pruneOldest: `
    DELETE FROM ${TABLE} WHERE id IN (
      SELECT id FROM ${TABLE} ORDER BY timestamp ASC LIMIT @toDelete
    )`,
} as const;

/**
 * Build a SELECT query with optional filters.
 */
export function buildSelectAll(where: string): string {
  return `SELECT * FROM ${TABLE} ${where} ORDER BY timestamp DESC LIMIT @limit OFFSET @offset`;
}

/**
 * Build a COUNT query with optional filters.
 */
export function buildCount(where: string): string {
  return `SELECT COUNT(*) as count FROM ${TABLE} ${where}`;
}
