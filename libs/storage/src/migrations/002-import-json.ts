/**
 * Migration 002 — Import existing JSON files into DB
 *
 * Reads JSON config/state/policy files from the standard locations,
 * imports them into the DB, and renames originals to .bak.
 *
 * Vault data goes into _pending_vault_import (deferred until first unlock).
 */

import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Migration } from './types';

/** Shape of the legacy config.json file */
interface LegacyConfig {
  version?: string;
  defaultAction?: string;
  daemon?: { port?: number; host?: string; logLevel?: string; enableHostsEntry?: boolean };
  vault?: { enabled?: boolean; provider?: string };
  policies?: LegacyPolicy[];
  skills?: unknown;
  soul?: unknown;
  broker?: unknown;
}

/** Shape of a legacy policy entry */
interface LegacyPolicy {
  id: string;
  name?: string;
  action?: string;
  target?: string;
  patterns?: string[];
  enabled?: boolean;
  priority?: number;
  operations?: string[];
  preset?: string;
  scope?: string;
  networkAccess?: string;
}

/** Shape of the legacy state.json file */
interface LegacyState {
  version?: string;
  installedAt?: string;
  daemon?: { running?: boolean; pid?: number; startedAt?: string; port?: number };
  users?: Array<{ username: string; uid: number; type: string; createdAt?: string; homeDir?: string }>;
  groups?: Array<{ name: string; gid: number; type: string }>;
  agenco?: { authenticated?: boolean; lastAuthAt?: string; connectedIntegrations?: string[] };
  installation?: { preset?: string; baseName?: string; prefix?: string; wrappers?: string[]; seatbeltInstalled?: boolean };
  passcodeProtection?: { enabled?: boolean; allowAnonymousReadOnly?: boolean; failedAttempts?: number; lockedUntil?: string };
}

export class ImportJsonMigration implements Migration {
  readonly version = 2;
  readonly name = '002-import-json';

  up(db: Database.Database): void {
    // Determine the config directory from the DB path
    const dbPath = db.name;
    const configDir = path.dirname(dbPath);

    this.importConfig(db, configDir);
    this.importState(db, configDir);
    this.importPolicies(db, configDir);
    this.importVault(db, configDir);
  }

  private readJsonFile(filePath: string): unknown | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private backupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, filePath + '.bak');
      }
    } catch {
      // Non-fatal
    }
  }

  private importConfig(db: Database.Database, configDir: string): void {
    const configFile = path.join(configDir, 'config.json');
    const config = this.readJsonFile(configFile) as LegacyConfig | null;
    if (!config) return;

    const daemon = config.daemon ?? {};
    const vault = config.vault ?? {};

    db.prepare(`
      INSERT OR IGNORE INTO config (target_id, user_username, version, daemon_port, daemon_host, daemon_log_level,
        daemon_enable_hosts_entry, default_action, vault_enabled, vault_provider, skills_json, soul_json, broker_json)
      VALUES (NULL, NULL, @version, @daemonPort, @daemonHost, @daemonLogLevel,
        @daemonEnableHostsEntry, @defaultAction, @vaultEnabled, @vaultProvider, @skillsJson, @soulJson, @brokerJson)
    `).run({
      version: config.version ?? null,
      daemonPort: daemon.port ?? null,
      daemonHost: daemon.host ?? null,
      daemonLogLevel: daemon.logLevel ?? null,
      daemonEnableHostsEntry: daemon.enableHostsEntry ? 1 : null,
      defaultAction: config.defaultAction ?? null,
      vaultEnabled: vault.enabled ? 1 : vault.enabled === false ? 0 : null,
      vaultProvider: vault.provider ?? null,
      skillsJson: config.skills ? JSON.stringify(config.skills) : null,
      soulJson: config.soul ? JSON.stringify(config.soul) : null,
      brokerJson: config.broker ? JSON.stringify(config.broker) : null,
    });

    if (config.policies && config.policies.length > 0) {
      this.importPolicyArray(db, config.policies, null, null);
    }

    this.backupFile(configFile);
  }

  private importState(db: Database.Database, configDir: string): void {
    const stateFile = path.join(configDir, 'state.json');
    const state = this.readJsonFile(stateFile) as LegacyState | null;
    if (!state) return;

    const daemon = state.daemon ?? {};
    const agenco = state.agenco ?? {};
    const installation = state.installation ?? {};
    const passcode = state.passcodeProtection ?? {};

    db.prepare(`
      INSERT OR REPLACE INTO state (id, version, installed_at, daemon_running, daemon_pid, daemon_started_at,
        daemon_port, agenco_authenticated, agenco_last_auth_at, agenco_connected_integrations,
        installation_preset, installation_base_name, installation_prefix, installation_wrappers,
        installation_seatbelt_installed, passcode_enabled, passcode_allow_anonymous_read_only,
        passcode_failed_attempts, passcode_locked_until)
      VALUES (1, @version, @installedAt, @daemonRunning, @daemonPid, @daemonStartedAt,
        @daemonPort, @agencoAuthenticated, @agencoLastAuthAt, @agencoConnectedIntegrations,
        @installationPreset, @installationBaseName, @installationPrefix, @installationWrappers,
        @installationSeatbeltInstalled, @passcodeEnabled, @passcodeAllowAnonymousReadOnly,
        @passcodeFailedAttempts, @passcodeLockedUntil)
    `).run({
      version: state.version ?? '0.0.0',
      installedAt: state.installedAt ?? new Date().toISOString(),
      daemonRunning: daemon.running ? 1 : 0,
      daemonPid: daemon.pid ?? null,
      daemonStartedAt: daemon.startedAt ?? null,
      daemonPort: daemon.port ?? 5200,
      agencoAuthenticated: agenco.authenticated ? 1 : 0,
      agencoLastAuthAt: agenco.lastAuthAt ?? null,
      agencoConnectedIntegrations: JSON.stringify(agenco.connectedIntegrations ?? []),
      installationPreset: installation.preset ?? 'unknown',
      installationBaseName: installation.baseName ?? 'default',
      installationPrefix: installation.prefix ?? null,
      installationWrappers: JSON.stringify(installation.wrappers ?? []),
      installationSeatbeltInstalled: installation.seatbeltInstalled ? 1 : 0,
      passcodeEnabled: passcode.enabled != null ? (passcode.enabled ? 1 : 0) : null,
      passcodeAllowAnonymousReadOnly: passcode.allowAnonymousReadOnly != null ? (passcode.allowAnonymousReadOnly ? 1 : 0) : null,
      passcodeFailedAttempts: passcode.failedAttempts ?? null,
      passcodeLockedUntil: passcode.lockedUntil ?? null,
    });

    const users = state.users ?? [];
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (username, uid, type, created_at, home_dir)
      VALUES (@username, @uid, @type, @createdAt, @homeDir)
    `);
    for (const u of users) {
      insertUser.run({
        username: u.username,
        uid: u.uid,
        type: u.type,
        createdAt: u.createdAt ?? new Date().toISOString(),
        homeDir: u.homeDir ?? '',
      });
    }

    const groups = state.groups ?? [];
    const insertGroup = db.prepare(`
      INSERT OR IGNORE INTO groups_ (name, gid, type)
      VALUES (@name, @gid, @type)
    `);
    for (const g of groups) {
      insertGroup.run({ name: g.name, gid: g.gid, type: g.type });
    }

    this.backupFile(stateFile);
  }

  private importPolicies(db: Database.Database, configDir: string): void {
    const policiesFile = path.join(configDir, 'policies.json');
    const data = this.readJsonFile(policiesFile) as LegacyPolicy[] | null;
    if (!data || !Array.isArray(data)) return;

    this.importPolicyArray(db, data, null, null);
    this.backupFile(policiesFile);
  }

  private importPolicyArray(
    db: Database.Database,
    policies: LegacyPolicy[],
    targetId: string | null,
    userUsername: string | null,
  ): void {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO policies (id, target_id, user_username, name, action, target, patterns, enabled, priority, operations, preset, scope, network_access)
      VALUES (@id, @targetId, @userUsername, @name, @action, @target, @patterns, @enabled, @priority, @operations, @preset, @scope, @networkAccess)
    `);

    for (const p of policies) {
      stmt.run({
        id: p.id,
        targetId,
        userUsername,
        name: p.name ?? 'Unnamed',
        action: p.action ?? 'deny',
        target: p.target ?? 'command',
        patterns: JSON.stringify(p.patterns ?? []),
        enabled: p.enabled !== false ? 1 : 0,
        priority: p.priority ?? null,
        operations: p.operations ? JSON.stringify(p.operations) : null,
        preset: p.preset ?? null,
        scope: p.scope ?? null,
        networkAccess: p.networkAccess ?? null,
      });
    }
  }

  private importVault(db: Database.Database, configDir: string): void {
    const vaultFile = path.join(configDir, 'vault.enc');
    if (!fs.existsSync(vaultFile)) return;

    // Vault data is encrypted — store as pending import for later decryption
    try {
      const content = fs.readFileSync(vaultFile, 'utf8');
      db.prepare(`INSERT OR IGNORE INTO _pending_vault_import (key, value) VALUES ('vault_data', @value)`)
        .run({ value: content });
      this.backupFile(vaultFile);
    } catch {
      // Non-fatal — vault will start empty
    }
  }
}
