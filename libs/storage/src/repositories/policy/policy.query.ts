/**
 * Policy SQL queries
 */

const TABLE = 'policies';

export const Q = {
  insert: `
    INSERT INTO ${TABLE} (id, profile_id, name, action, target, patterns,
      enabled, priority, operations, preset, scope, network_access, created_at, updated_at)
    VALUES (@id, @profileId, @name, @action, @target, @patterns,
      @enabled, @priority, @operations, @preset, @scope, @networkAccess, @createdAt, @updatedAt)`,

  selectById: `SELECT * FROM ${TABLE} WHERE id = ?`,

  selectAllScoped: (clause: string) =>
    `SELECT * FROM ${TABLE} WHERE ${clause} ORDER BY priority DESC, name`,

  selectEnabledScoped: (clause: string) =>
    `SELECT * FROM ${TABLE} WHERE enabled = 1 AND (${clause}) ORDER BY priority DESC, name`,

  deleteById: `DELETE FROM ${TABLE} WHERE id = ?`,

  deleteScoped: (clause: string) =>
    `DELETE FROM ${TABLE} WHERE ${clause}`,

  countScoped: (clause: string) =>
    `SELECT COUNT(*) as count FROM ${TABLE} WHERE ${clause}`,
} as const;
