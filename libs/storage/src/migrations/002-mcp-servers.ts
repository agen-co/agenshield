/**
 * Migration 002 — MCP servers table + workspace_skills managed tracking
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class McpServersMigration implements Migration {
  readonly version = 2;
  readonly name = '002-mcp-servers';

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE mcp_servers (
        id                TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        slug              TEXT NOT NULL,
        description       TEXT DEFAULT '',
        transport         TEXT NOT NULL CHECK (transport IN ('stdio', 'sse', 'streamable-http')),
        url               TEXT,
        command           TEXT,
        args              TEXT DEFAULT '[]',
        env               TEXT DEFAULT '{}',
        headers           TEXT DEFAULT '{}',
        auth_type         TEXT DEFAULT 'none' CHECK (auth_type IN ('none', 'oauth', 'apikey', 'bearer')),
        auth_config       TEXT,
        source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'cloud', 'agenco', 'workspace')),
        managed           INTEGER NOT NULL DEFAULT 0,
        managed_source    TEXT,
        status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'pending', 'blocked')),
        profile_id        TEXT,
        config_json       TEXT,
        supported_targets TEXT DEFAULT '[]',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_mcp_servers_slug_profile ON mcp_servers(slug, COALESCE(profile_id, '__NULL__'));
      CREATE INDEX idx_mcp_servers_slug ON mcp_servers(slug);
      CREATE INDEX idx_mcp_servers_profile ON mcp_servers(profile_id);
      CREATE INDEX idx_mcp_servers_status ON mcp_servers(status);
      CREATE INDEX idx_mcp_servers_managed ON mcp_servers(managed);
      CREATE INDEX idx_mcp_servers_source ON mcp_servers(source);

      -- Extend workspace_skills with managed tracking
      ALTER TABLE workspace_skills ADD COLUMN managed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspace_skills ADD COLUMN managed_source TEXT;
    `);
  }
}
