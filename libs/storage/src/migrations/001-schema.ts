/**
 * Migration 001 — Consolidated schema (fresh DB only)
 *
 * Single migration creating all tables, indexes, and the singleton state row.
 * Uses profile_id for scoping (replaces target_id/user_username).
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class SchemaMigration implements Migration {
  readonly version = 1;
  readonly name = '001-schema';

  up(db: Database.Database): void {
    db.exec(`
      -- System metadata (unencrypted)
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Profiles (scoping context: global defaults or per-target)
      CREATE TABLE profiles (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        type             TEXT NOT NULL DEFAULT 'target'
                           CHECK (type IN ('global', 'target')),
        target_name      TEXT,
        preset_id        TEXT,
        description      TEXT,
        agent_username   TEXT,
        agent_uid        INTEGER,
        agent_home_dir   TEXT,
        broker_username  TEXT,
        broker_uid       INTEGER,
        broker_home_dir  TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Config (scoped: global -> profile)
      CREATE TABLE config (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id                TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        version                   TEXT,
        daemon_port               INTEGER,
        daemon_host               TEXT,
        daemon_log_level          TEXT,
        daemon_enable_hosts_entry INTEGER,
        default_action            TEXT,
        vault_enabled             INTEGER,
        vault_provider            TEXT,
        skills_json               TEXT,
        soul_json                 TEXT,
        broker_json               TEXT,
        updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(profile_id)
      );

      -- Policies (scoped)
      CREATE TABLE policies (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        action         TEXT NOT NULL CHECK (action IN ('allow', 'deny', 'approval')),
        target         TEXT NOT NULL CHECK (target IN ('skill', 'command', 'url', 'filesystem')),
        patterns       TEXT NOT NULL,
        enabled        INTEGER NOT NULL DEFAULT 1,
        priority       INTEGER,
        operations     TEXT,
        preset         TEXT,
        scope          TEXT,
        network_access TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_policies_scope ON policies(profile_id);
      CREATE INDEX idx_policies_target ON policies(target);
      CREATE INDEX idx_policies_enabled ON policies(enabled);

      -- State (global singleton)
      CREATE TABLE state (
        id                                 INTEGER PRIMARY KEY CHECK (id = 1),
        version                            TEXT NOT NULL,
        installed_at                       TEXT NOT NULL,
        daemon_running                     INTEGER NOT NULL DEFAULT 0,
        daemon_pid                         INTEGER,
        daemon_started_at                  TEXT,
        daemon_port                        INTEGER NOT NULL DEFAULT 5200,
        agenco_authenticated               INTEGER NOT NULL DEFAULT 0,
        agenco_last_auth_at                TEXT,
        agenco_connected_integrations      TEXT NOT NULL DEFAULT '[]',
        installation_preset                TEXT NOT NULL DEFAULT 'unknown',
        installation_base_name             TEXT NOT NULL DEFAULT 'default',
        installation_prefix                TEXT,
        installation_wrappers              TEXT NOT NULL DEFAULT '[]',
        installation_seatbelt_installed    INTEGER NOT NULL DEFAULT 0,
        passcode_enabled                   INTEGER,
        passcode_allow_anonymous_read_only INTEGER,
        passcode_failed_attempts           INTEGER,
        passcode_locked_until              TEXT,
        updated_at                         TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- System users (OS-level tracking, not scoping)
      CREATE TABLE users (
        username   TEXT PRIMARY KEY,
        uid        INTEGER NOT NULL,
        type       TEXT NOT NULL DEFAULT 'agent',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        home_dir   TEXT
      );

      -- System groups (OS-level tracking, not scoping)
      CREATE TABLE groups_ (
        name TEXT PRIMARY KEY,
        gid  INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'workspace'
      );

      -- Secrets (scoped + encrypted)
      CREATE TABLE secrets (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        value_encrypted TEXT,
        scope           TEXT NOT NULL DEFAULT 'global'
                          CHECK(scope IN ('global', 'policed', 'standalone')),
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_secrets_scope ON secrets(profile_id);
      CREATE INDEX idx_secrets_name ON secrets(name);

      -- Secret-policy links
      CREATE TABLE secret_policies (
        secret_id TEXT NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
        policy_id TEXT NOT NULL,
        PRIMARY KEY (secret_id, policy_id)
      );

      -- Skills (global identity)
      CREATE TABLE skills (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        slug        TEXT NOT NULL UNIQUE,
        author      TEXT,
        description TEXT,
        homepage    TEXT,
        tags        TEXT NOT NULL DEFAULT '[]',
        source      TEXT NOT NULL DEFAULT 'unknown',
        remote_id   TEXT,
        is_public   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_skills_slug ON skills(slug);
      CREATE INDEX idx_skills_name ON skills(name);

      -- Skill versions
      CREATE TABLE skill_versions (
        id                 TEXT PRIMARY KEY,
        skill_id           TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        version            TEXT NOT NULL,
        folder_path        TEXT NOT NULL,
        content_hash       TEXT NOT NULL,
        hash_updated_at    TEXT NOT NULL,
        approval           TEXT NOT NULL DEFAULT 'unknown',
        approved_at        TEXT,
        trusted            INTEGER NOT NULL DEFAULT 0,
        metadata_json      TEXT,
        analysis_status    TEXT NOT NULL DEFAULT 'pending',
        analysis_json      TEXT,
        analyzed_at        TEXT,
        required_bins      TEXT NOT NULL DEFAULT '[]',
        required_env       TEXT NOT NULL DEFAULT '[]',
        extracted_commands TEXT NOT NULL DEFAULT '[]',
        backup_hash        TEXT,
        auto_update        INTEGER NOT NULL DEFAULT 1,
        pinned_version     TEXT,
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(skill_id, version)
      );
      CREATE INDEX idx_sv_skill ON skill_versions(skill_id);
      CREATE INDEX idx_sv_approval ON skill_versions(approval);

      -- Skill files (per-file hash registry)
      CREATE TABLE skill_files (
        id                TEXT PRIMARY KEY,
        skill_version_id  TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
        relative_path     TEXT NOT NULL,
        file_hash         TEXT NOT NULL,
        size_bytes        INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(skill_version_id, relative_path)
      );
      CREATE INDEX idx_sf_version ON skill_files(skill_version_id);

      -- Skill installations (per-profile)
      CREATE TABLE skill_installations (
        id                TEXT PRIMARY KEY,
        skill_version_id  TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
        profile_id        TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        status            TEXT NOT NULL DEFAULT 'active',
        wrapper_path      TEXT,
        auto_update       INTEGER NOT NULL DEFAULT 1,
        pinned_version    TEXT,
        installed_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(skill_version_id, profile_id)
      );
      CREATE INDEX idx_si_version ON skill_installations(skill_version_id);
      CREATE INDEX idx_si_profile ON skill_installations(profile_id);

      -- Allowed commands
      CREATE TABLE allowed_commands (
        name     TEXT PRIMARY KEY,
        paths    TEXT NOT NULL DEFAULT '[]',
        added_at TEXT NOT NULL,
        added_by TEXT NOT NULL DEFAULT 'policy',
        category TEXT
      );

      -- Policy graph nodes
      CREATE TABLE policy_nodes (
        id             TEXT PRIMARY KEY,
        policy_id      TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
        profile_id     TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        dormant        INTEGER NOT NULL DEFAULT 0,
        metadata       TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_pn_policy ON policy_nodes(policy_id);
      CREATE INDEX idx_pn_scope ON policy_nodes(profile_id);

      -- Policy graph edges
      CREATE TABLE policy_edges (
        id              TEXT PRIMARY KEY,
        source_node_id  TEXT NOT NULL REFERENCES policy_nodes(id) ON DELETE CASCADE,
        target_node_id  TEXT NOT NULL REFERENCES policy_nodes(id) ON DELETE CASCADE,
        effect          TEXT NOT NULL CHECK (effect IN ('activate', 'deny', 'inject_secret', 'grant_network', 'grant_fs', 'revoke')),
        lifetime        TEXT NOT NULL DEFAULT 'session' CHECK (lifetime IN ('session', 'process', 'once', 'persistent')),
        priority        INTEGER NOT NULL DEFAULT 0,
        condition       TEXT,
        secret_name     TEXT,
        grant_patterns  TEXT,
        delay_ms        INTEGER NOT NULL DEFAULT 0,
        enabled         INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_pe_source ON policy_edges(source_node_id);
      CREATE INDEX idx_pe_target ON policy_edges(target_node_id);
      CREATE INDEX idx_pe_effect ON policy_edges(effect);

      -- Edge activations (runtime state)
      CREATE TABLE edge_activations (
        id           TEXT PRIMARY KEY,
        edge_id      TEXT NOT NULL REFERENCES policy_edges(id) ON DELETE CASCADE,
        activated_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at   TEXT,
        process_id   INTEGER,
        consumed     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_ea_edge ON edge_activations(edge_id);
      CREATE INDEX idx_ea_active ON edge_activations(consumed, expires_at);
    `);
  }
}
