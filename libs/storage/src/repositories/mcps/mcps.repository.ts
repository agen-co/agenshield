/**
 * MCP server repository
 *
 * Manages MCP server records for registration, cloud sync, and workspace monitoring.
 * MCP servers can be global (profileId: null) or profile-scoped.
 */

import type { McpServer } from '@agenshield/ipc';
import type { DbMcpServerRow } from '../../types';
import { BaseRepository } from '../base.repository';
import { mapMcpServer } from './mcps.model';
import { Q } from './mcps.query';
import {
  CreateMcpServerSchema,
  UpdateMcpServerSchema,
  UpdateMcpServerCodec,
} from './mcps.schema';
import type { CreateMcpServerInput, UpdateMcpServerInput } from './mcps.schema';

export class McpServerRepository extends BaseRepository {
  /**
   * Create a new MCP server.
   */
  create(input: CreateMcpServerInput): McpServer {
    const data = this.validate(CreateMcpServerSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insert).run({
      id,
      name: data.name,
      slug: data.slug,
      description: data.description ?? '',
      transport: data.transport,
      url: data.url ?? null,
      command: data.command ?? null,
      args: JSON.stringify(data.args ?? []),
      env: JSON.stringify(data.env ?? {}),
      headers: JSON.stringify(data.headers ?? {}),
      authType: data.authType ?? 'none',
      authConfig: data.authConfig ? JSON.stringify(data.authConfig) : null,
      source: data.source ?? 'manual',
      managed: 0,
      managedSource: null,
      status: data.status ?? 'active',
      profileId: data.profileId ?? null,
      configJson: data.configJson ? JSON.stringify(data.configJson) : null,
      supportedTargets: JSON.stringify(data.supportedTargets ?? []),
      createdAt: now,
      updatedAt: now,
    });

    return this.getById(id)!;
  }

  /**
   * Create a managed (admin-enforced) MCP server.
   */
  createManaged(input: CreateMcpServerInput, source: string): McpServer {
    const data = this.validate(CreateMcpServerSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insert).run({
      id,
      name: data.name,
      slug: data.slug,
      description: data.description ?? '',
      transport: data.transport,
      url: data.url ?? null,
      command: data.command ?? null,
      args: JSON.stringify(data.args ?? []),
      env: JSON.stringify(data.env ?? {}),
      headers: JSON.stringify(data.headers ?? {}),
      authType: data.authType ?? 'none',
      authConfig: data.authConfig ? JSON.stringify(data.authConfig) : null,
      source: data.source ?? 'cloud',
      managed: 1,
      managedSource: source,
      status: data.status ?? 'active',
      profileId: data.profileId ?? null,
      configJson: data.configJson ? JSON.stringify(data.configJson) : null,
      supportedTargets: JSON.stringify(data.supportedTargets ?? []),
      createdAt: now,
      updatedAt: now,
    });

    return this.getById(id)!;
  }

  /**
   * Get an MCP server by ID.
   */
  getById(id: string): McpServer | null {
    const row = this.db.prepare(Q.selectById).get(id) as DbMcpServerRow | undefined;
    return row ? mapMcpServer(row) : null;
  }

  /**
   * Get an MCP server by slug (optionally scoped to a profile).
   */
  getBySlug(slug: string, profileId?: string | null): McpServer | null {
    const row = this.db.prepare(Q.selectBySlug).get({
      slug,
      profileId: profileId ?? null,
    }) as DbMcpServerRow | undefined;
    return row ? mapMcpServer(row) : null;
  }

  /**
   * Get all MCP servers.
   */
  getAll(): McpServer[] {
    const rows = this.db.prepare(Q.selectAll).all() as DbMcpServerRow[];
    return rows.map(mapMcpServer);
  }

  /**
   * Get all enabled (active) MCP servers.
   */
  getEnabled(): McpServer[] {
    const rows = this.db.prepare(Q.selectEnabled).all() as DbMcpServerRow[];
    return rows.map(mapMcpServer);
  }

  /**
   * Get all managed MCP servers.
   */
  getManaged(): McpServer[] {
    const rows = this.db.prepare(Q.selectManaged).all() as DbMcpServerRow[];
    return rows.map(mapMcpServer);
  }

  /**
   * Get MCP servers for a specific profile.
   */
  getByProfile(profileId: string): McpServer[] {
    const rows = this.db.prepare(Q.selectByProfile).all(profileId) as DbMcpServerRow[];
    return rows.map(mapMcpServer);
  }

  /**
   * Get MCP servers by source.
   */
  getBySource(source: string): McpServer[] {
    const rows = this.db.prepare(Q.selectBySource).all(source) as DbMcpServerRow[];
    return rows.map(mapMcpServer);
  }

  /**
   * Get MCP servers by status.
   */
  getByStatus(status: string): McpServer[] {
    const rows = this.db.prepare(Q.selectByStatus).all(status) as DbMcpServerRow[];
    return rows.map(mapMcpServer);
  }

  /**
   * Update an MCP server.
   */
  update(id: string, input: UpdateMcpServerInput): McpServer | null {
    const data = this.validate(UpdateMcpServerSchema, input);
    if (!this.getById(id)) return null;
    const encoded = UpdateMcpServerCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'mcp_servers', 'id = @id', { id });
    return this.getById(id);
  }

  /**
   * Delete an MCP server.
   */
  delete(id: string): boolean {
    const result = this.db.prepare(Q.deleteById).run(id);
    return result.changes > 0;
  }

  /**
   * Delete all managed MCP servers from a specific source.
   * Used by batch sync to replace all servers from an external source.
   */
  deleteManagedBySource(source: string): number {
    const result = this.db.prepare(Q.deleteManagedBySource).run({ source });
    return result.changes;
  }

  /**
   * Count all MCP servers.
   */
  count(): number {
    const row = this.db.prepare(Q.countAll).get() as { count: number };
    return row.count;
  }

  /**
   * Count MCP servers by status.
   */
  countByStatus(status: string): number {
    const row = this.db.prepare(Q.countByStatus).get(status) as { count: number };
    return row.count;
  }
}
