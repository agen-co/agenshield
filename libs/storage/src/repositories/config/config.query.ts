/**
 * Config SQL queries
 */

const TABLE = 'config';

export const Q = {
  selectWhere: (clause: string) =>
    `SELECT * FROM ${TABLE} WHERE ${clause}`,

  upsert: `
    INSERT INTO ${TABLE} (target_id, user_username, version, daemon_port, daemon_host,
      daemon_log_level, daemon_enable_hosts_entry, default_action, vault_enabled, vault_provider,
      skills_json, soul_json, broker_json, updated_at)
    VALUES (@targetId, @userUsername, @version, @daemonPort, @daemonHost,
      @daemonLogLevel, @daemonEnableHostsEntry, @defaultAction, @vaultEnabled, @vaultProvider,
      @skillsJson, @soulJson, @brokerJson, @updatedAt)
    ON CONFLICT(target_id, user_username) DO UPDATE SET
      version = COALESCE(@version, version),
      daemon_port = COALESCE(@daemonPort, daemon_port),
      daemon_host = COALESCE(@daemonHost, daemon_host),
      daemon_log_level = COALESCE(@daemonLogLevel, daemon_log_level),
      daemon_enable_hosts_entry = COALESCE(@daemonEnableHostsEntry, daemon_enable_hosts_entry),
      default_action = COALESCE(@defaultAction, default_action),
      vault_enabled = COALESCE(@vaultEnabled, vault_enabled),
      vault_provider = COALESCE(@vaultProvider, vault_provider),
      skills_json = COALESCE(@skillsJson, skills_json),
      soul_json = COALESCE(@soulJson, soul_json),
      broker_json = COALESCE(@brokerJson, broker_json),
      updated_at = @updatedAt`,

  deleteWhere: (clause: string) =>
    `DELETE FROM ${TABLE} WHERE ${clause}`,
};
