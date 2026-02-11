/**
 * State model — DB row mapper
 */

import type { SystemState } from '@agenshield/ipc';
import type { DbStateRow } from '../../types';

// ---- Row mapper ----

export function mapState(row: DbStateRow): SystemState {
  return {
    version: row.version,
    installedAt: row.installed_at,
    daemon: {
      running: row.daemon_running === 1,
      pid: row.daemon_pid ?? undefined,
      startedAt: row.daemon_started_at ?? undefined,
      port: row.daemon_port,
    },
    users: [],  // Loaded separately from users table
    groups: [], // Loaded separately from groups_ table
    agenco: {
      authenticated: row.agenco_authenticated === 1,
      lastAuthAt: row.agenco_last_auth_at ?? undefined,
      connectedIntegrations: JSON.parse(row.agenco_connected_integrations),
    },
    installation: {
      preset: row.installation_preset,
      baseName: row.installation_base_name,
      prefix: row.installation_prefix ?? undefined,
      wrappers: JSON.parse(row.installation_wrappers),
      seatbeltInstalled: row.installation_seatbelt_installed === 1,
    },
    passcodeProtection: row.passcode_enabled != null ? {
      enabled: row.passcode_enabled === 1,
      allowAnonymousReadOnly: row.passcode_allow_anonymous_read_only != null ? row.passcode_allow_anonymous_read_only === 1 : undefined,
      failedAttempts: row.passcode_failed_attempts ?? undefined,
      lockedUntil: row.passcode_locked_until ?? undefined,
    } : undefined,
  };
}
