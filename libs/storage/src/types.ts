/**
 * Internal DB row types
 *
 * These represent the raw SQLite row shapes (snake_case columns).
 * Domain types from @agenshield/ipc use camelCase.
 */

export interface DbProfileRow {
  id: string;
  name: string;
  type: string;
  target_name: string | null;
  preset_id: string | null;
  description: string | null;
  agent_username: string | null;
  agent_uid: number | null;
  agent_home_dir: string | null;
  broker_username: string | null;
  broker_uid: number | null;
  broker_home_dir: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbConfigRow {
  id: number;
  profile_id: string | null;
  version: string | null;
  daemon_port: number | null;
  daemon_host: string | null;
  daemon_log_level: string | null;
  daemon_enable_hosts_entry: number | null;
  default_action: string | null;
  vault_enabled: number | null;
  vault_provider: string | null;
  skills_json: string | null;
  soul_json: string | null;
  broker_json: string | null;
  updated_at: string;
}

export interface DbPolicyRow {
  id: string;
  profile_id: string | null;
  name: string;
  action: string;
  target: string;
  patterns: string;
  enabled: number;
  priority: number | null;
  operations: string | null;
  preset: string | null;
  scope: string | null;
  network_access: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbStateRow {
  id: number;
  version: string;
  installed_at: string;
  daemon_running: number;
  daemon_pid: number | null;
  daemon_started_at: string | null;
  daemon_port: number;
  agenco_authenticated: number;
  agenco_last_auth_at: string | null;
  agenco_connected_integrations: string;
  installation_preset: string;
  installation_base_name: string;
  installation_prefix: string | null;
  installation_wrappers: string;
  installation_seatbelt_installed: number;
  passcode_enabled: number | null;
  passcode_allow_anonymous_read_only: number | null;
  passcode_failed_attempts: number | null;
  passcode_locked_until: string | null;
  updated_at: string;
}

export interface DbUserRow {
  username: string;
  uid: number;
  type: string;
  created_at: string;
  home_dir: string | null;
}

export interface DbGroupRow {
  name: string;
  gid: number;
  type: string;
}

export interface DbSkillRow {
  id: string;
  name: string;
  slug: string;
  author: string | null;
  description: string | null;
  homepage: string | null;
  tags: string;
  source: string;
  remote_id: string | null;
  is_public: number;
  created_at: string;
  updated_at: string;
}

export interface DbSkillVersionRow {
  id: string;
  skill_id: string;
  version: string;
  folder_path: string;
  content_hash: string;
  hash_updated_at: string;
  approval: string;
  approved_at: string | null;
  trusted: number;
  metadata_json: string | null;
  analysis_status: string;
  analysis_json: string | null;
  analyzed_at: string | null;
  required_bins: string;
  required_env: string;
  extracted_commands: string;
  backup_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbSkillFileRow {
  id: string;
  skill_version_id: string;
  relative_path: string;
  file_hash: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface DbSkillInstallationRow {
  id: string;
  skill_version_id: string;
  profile_id: string | null;
  status: string;
  wrapper_path: string | null;
  auto_update: number;
  pinned_version: string | null;
  installed_at: string;
  updated_at: string;
}

export interface DbActivityEventRow {
  id: number;
  profile_id: string | null;
  type: string;
  timestamp: string;
  data: string;
  created_at: string;
}

export interface DbAllowedCommandRow {
  name: string;
  paths: string;
  added_at: string;
  added_by: string;
  category: string | null;
}

export interface DbPolicyNodeRow {
  id: string;
  policy_id: string;
  profile_id: string | null;
  dormant: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbPolicyEdgeRow {
  id: string;
  source_node_id: string;
  target_node_id: string;
  effect: string;
  lifetime: string;
  priority: number;
  condition: string | null;
  secret_name: string | null;
  grant_patterns: string | null;
  delay_ms: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface DbEdgeActivationRow {
  id: string;
  edge_id: string;
  activated_at: string;
  expires_at: string | null;
  process_id: number | null;
  consumed: number;
}

export interface DbSecretRow {
  id: string;
  profile_id: string | null;
  name: string;
  value_encrypted: string | null;
  scope: string;
  created_at: string;
}

export interface DbMetaRow {
  key: string;
  value: string;
}
