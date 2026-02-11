/**
 * Config model — DB row mapper
 */

import type { DbConfigRow } from '../../types';
import type { ConfigData } from './config.schema';

// ---- Row mapper ----

export function mapConfig(row: DbConfigRow): ConfigData {
  return {
    version: row.version,
    daemonPort: row.daemon_port,
    daemonHost: row.daemon_host,
    daemonLogLevel: row.daemon_log_level,
    daemonEnableHostsEntry:
      row.daemon_enable_hosts_entry != null
        ? row.daemon_enable_hosts_entry === 1
        : null,
    defaultAction: row.default_action,
    vaultEnabled:
      row.vault_enabled != null ? row.vault_enabled === 1 : null,
    vaultProvider: row.vault_provider,
    skillsJson: row.skills_json,
    soulJson: row.soul_json,
    brokerJson: row.broker_json,
  };
}
