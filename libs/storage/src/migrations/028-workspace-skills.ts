import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class WorkspaceSkillsMigration implements Migration {
  readonly version = 28;
  readonly name = '028-workspace-skills';

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE workspace_skills (
        id               TEXT PRIMARY KEY,
        profile_id       TEXT NOT NULL,
        workspace_path   TEXT NOT NULL,
        skill_name       TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','denied','removed','cloud_forced')),
        content_hash     TEXT,
        backup_hash      TEXT,
        approved_by      TEXT,
        approved_at      TEXT,
        cloud_skill_id   TEXT,
        removed_at       TEXT,
        acl_applied      INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(workspace_path, skill_name)
      );

      CREATE INDEX idx_ws_skills_workspace ON workspace_skills(workspace_path);
      CREATE INDEX idx_ws_skills_status ON workspace_skills(status);
      CREATE INDEX idx_ws_skills_profile ON workspace_skills(profile_id);
    `);
  }
}
