/**
 * Alerts SQL queries
 */

const TABLE = 'alerts';

export const Q = {
  insert: `
    INSERT INTO ${TABLE} (activity_event_id, profile_id, event_type, severity, title, description, navigation_target, details, created_at)
    VALUES (@activityEventId, @profileId, @eventType, @severity, @title, @description, @navigationTarget, @details, @createdAt)`,

  selectById: `SELECT * FROM ${TABLE} WHERE id = ?`,

  acknowledge: `UPDATE ${TABLE} SET acknowledged_at = @acknowledgedAt WHERE id = @id AND acknowledged_at IS NULL`,

  acknowledgeAll: `UPDATE ${TABLE} SET acknowledged_at = @acknowledgedAt WHERE acknowledged_at IS NULL`,

  deleteAll: `DELETE FROM ${TABLE}`,
} as const;

/**
 * Build a SELECT query with optional filters.
 */
export function buildSelectAll(where: string): string {
  return `SELECT * FROM ${TABLE} ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`;
}

/**
 * Build a COUNT query with optional filters.
 */
export function buildCount(where: string): string {
  return `SELECT COUNT(*) as count FROM ${TABLE} ${where}`;
}
