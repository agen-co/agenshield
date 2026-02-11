import Database from 'better-sqlite3';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { InitialSchemaMigration } from '../migrations/001-initial-schema';

function tmpDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('001-initial-schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = tmpDb();
    new InitialSchemaMigration().up(db);
  });

  afterEach(() => {
    db.close();
  });

  const expectedTables = [
    'meta', 'targets', 'users', 'groups_', 'target_users', 'config', 'policies',
    'state', 'vault_secrets', 'vault_secret_policies', 'vault_kv',
    'skills', 'skill_versions', 'skill_files', 'skill_installations',
    'activity_events', 'allowed_commands', '_pending_vault_import',
    'policy_nodes', 'policy_edges', 'edge_activations',
  ];

  for (const table of expectedTables) {
    it(`creates table ${table}`, () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      expect(row).toBeDefined();
    });
  }

  it('creates indexes', () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_policies_scope');
    expect(indexNames).toContain('idx_policies_target');
    expect(indexNames).toContain('idx_skills_slug');
    expect(indexNames).toContain('idx_activity_ts');
    expect(indexNames).toContain('idx_pn_policy');
    expect(indexNames).toContain('idx_pe_source');
    expect(indexNames).toContain('idx_ea_edge');
  });

  it('state table enforces singleton constraint', () => {
    db.prepare("INSERT INTO state (id, version, installed_at) VALUES (1, '1.0', '2025-01-01')").run();
    expect(() => {
      db.prepare("INSERT INTO state (id, version, installed_at) VALUES (2, '1.0', '2025-01-01')").run();
    }).toThrow();
  });

  it('policies table enforces action check constraint', () => {
    db.prepare("INSERT INTO targets (id, name) VALUES ('t1', 'Test')").run();
    expect(() => {
      db.prepare("INSERT INTO policies (id, name, action, target, patterns) VALUES ('p1', 'Test', 'invalid', 'command', '[]')").run();
    }).toThrow();
  });

  it('vault_secrets table enforces scope check constraint', () => {
    expect(() => {
      db.prepare("INSERT INTO vault_secrets (id, name, value_encrypted, scope) VALUES ('s1', 'test', 'enc', 'invalid')").run();
    }).toThrow();
  });

  it('foreign keys cascade on target delete', () => {
    db.prepare("INSERT INTO targets (id, name) VALUES ('t1', 'Test')").run();
    db.prepare("INSERT INTO policies (id, target_id, name, action, target, patterns) VALUES ('p1', 't1', 'Test', 'allow', 'command', '[]')").run();
    db.prepare("DELETE FROM targets WHERE id = 't1'").run();
    const policy = db.prepare("SELECT * FROM policies WHERE id = 'p1'").get();
    expect(policy).toBeUndefined();
  });
});
