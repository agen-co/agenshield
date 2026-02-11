/**
 * Target SQL queries
 */

const TARGETS = 'targets';
const TARGET_USERS = 'target_users';

export const Q = {
  insert: `
    INSERT INTO ${TARGETS} (id, name, preset_id, description, created_at, updated_at)
    VALUES (@id, @name, @presetId, @description, @createdAt, @updatedAt)`,
  selectById: `SELECT * FROM ${TARGETS} WHERE id = ?`,
  selectAll: `SELECT * FROM ${TARGETS} ORDER BY name`,
  delete: `DELETE FROM ${TARGETS} WHERE id = ?`,

  insertUser: `
    INSERT INTO ${TARGET_USERS} (target_id, user_username, role, created_at)
    VALUES (@targetId, @userUsername, @role, @createdAt)`,
  deleteUser: `DELETE FROM ${TARGET_USERS} WHERE target_id = ? AND user_username = ?`,
  selectUsers: `SELECT * FROM ${TARGET_USERS} WHERE target_id = ?`,
} as const;
