/**
 * MCP server SQL queries
 */

const TABLE = 'mcp_servers';

export const Q = {
  insert: `
    INSERT INTO ${TABLE} (id, name, slug, description, transport, url, command,
      args, env, headers, auth_type, auth_config, source, managed, managed_source,
      status, profile_id, config_json, supported_targets, created_at, updated_at)
    VALUES (@id, @name, @slug, @description, @transport, @url, @command,
      @args, @env, @headers, @authType, @authConfig, @source, @managed, @managedSource,
      @status, @profileId, @configJson, @supportedTargets, @createdAt, @updatedAt)`,

  selectById: `SELECT * FROM ${TABLE} WHERE id = ?`,

  selectBySlug: `SELECT * FROM ${TABLE} WHERE slug = @slug AND (profile_id IS @profileId OR (@profileId IS NULL AND profile_id IS NULL))`,

  selectAll: `SELECT * FROM ${TABLE} ORDER BY name`,

  selectByProfile: `SELECT * FROM ${TABLE} WHERE profile_id = ? ORDER BY name`,

  selectBySource: `SELECT * FROM ${TABLE} WHERE source = ? ORDER BY name`,

  selectManaged: `SELECT * FROM ${TABLE} WHERE managed = 1 ORDER BY name`,

  selectEnabled: `SELECT * FROM ${TABLE} WHERE status = 'active' ORDER BY name`,

  selectByStatus: `SELECT * FROM ${TABLE} WHERE status = ? ORDER BY name`,

  deleteById: `DELETE FROM ${TABLE} WHERE id = ?`,

  deleteManagedBySource: `DELETE FROM ${TABLE} WHERE managed = 1 AND managed_source = @source`,

  countAll: `SELECT COUNT(*) as count FROM ${TABLE}`,

  countByStatus: `SELECT COUNT(*) as count FROM ${TABLE} WHERE status = ?`,
} as const;
