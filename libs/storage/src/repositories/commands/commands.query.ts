/**
 * Commands SQL queries
 */

const TABLE = 'allowed_commands';

export const Q = {
  insert: `
    INSERT INTO ${TABLE} (name, paths, added_at, added_by, category)
    VALUES (@name, @paths, @addedAt, @addedBy, @category)
    ON CONFLICT(name) DO UPDATE SET
      paths = @paths, added_by = @addedBy, category = @category`,

  selectByName: `SELECT * FROM ${TABLE} WHERE name = ?`,

  selectAll: `SELECT * FROM ${TABLE} ORDER BY name`,

  selectByCategory: `SELECT * FROM ${TABLE} WHERE category = ? ORDER BY name`,

  deleteByName: `DELETE FROM ${TABLE} WHERE name = ?`,

  existsByName: `SELECT 1 FROM ${TABLE} WHERE name = ?`,
} as const;
