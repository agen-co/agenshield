/**
 * Profile SQL queries
 */

const TABLE = 'profiles';

export const Q = {
  insert: `
    INSERT INTO ${TABLE} (id, name, type, target_name, preset_id, description,
      agent_username, agent_uid, agent_home_dir, broker_username, broker_uid, broker_home_dir,
      broker_token, created_at, updated_at)
    VALUES (@id, @name, @type, @targetName, @presetId, @description,
      @agentUsername, @agentUid, @agentHomeDir, @brokerUsername, @brokerUid, @brokerHomeDir,
      @brokerToken, @createdAt, @updatedAt)`,
  selectById: `SELECT * FROM ${TABLE} WHERE id = ?`,
  selectAll: `SELECT * FROM ${TABLE} ORDER BY name`,
  selectByType: `SELECT * FROM ${TABLE} WHERE type = ? ORDER BY name`,
  selectGlobal: `SELECT * FROM ${TABLE} WHERE type = 'global' LIMIT 1`,
  selectByToken: `SELECT * FROM ${TABLE} WHERE broker_token = ?`,
  delete: `DELETE FROM ${TABLE} WHERE id = ?`,
} as const;
