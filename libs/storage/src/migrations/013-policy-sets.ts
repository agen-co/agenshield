/**
 * Migration 013 — Policy sets for multi-tenancy hierarchy
 *
 * Creates policy_sets and policy_set_members tables for parent-chain
 * policy inheritance (org → team → target).
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class PolicySetsMigration implements Migration {
  readonly version = 13;
  readonly name = '013-policy-sets';

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS policy_sets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT REFERENCES policy_sets(id) ON DELETE SET NULL,
        profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        enforced INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS policy_set_members (
        policy_set_id TEXT NOT NULL REFERENCES policy_sets(id) ON DELETE CASCADE,
        policy_id TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
        PRIMARY KEY (policy_set_id, policy_id)
      );

      CREATE INDEX IF NOT EXISTS idx_policy_sets_parent ON policy_sets(parent_id);
      CREATE INDEX IF NOT EXISTS idx_policy_sets_profile ON policy_sets(profile_id);
      CREATE INDEX IF NOT EXISTS idx_policy_set_members_policy ON policy_set_members(policy_id);
    `);
  }
}
