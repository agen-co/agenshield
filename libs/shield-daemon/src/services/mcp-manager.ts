/**
 * MCP Manager — Singleton facade for MCP server operations
 *
 * Coordinates between storage, config injection, and workspace scanning.
 */

import type { McpServer, CreateMcpServerInput } from '@agenshield/ipc';
import type { Storage } from '@agenshield/storage';
import { McpConfigInjector } from './mcp-config-injector';
import { WorkspaceMcpScanner } from './workspace-mcp-scanner';
import { McpServerNotFoundError } from '../errors';
import { emitEvent } from '../events/emitter';

let manager: McpManager | null = null;

export function initMcpManager(
  storage: Storage,
  injector: McpConfigInjector,
  scanner: WorkspaceMcpScanner,
): McpManager {
  manager = new McpManager(storage, injector, scanner);
  return manager;
}

export function getMcpManager(): McpManager {
  if (!manager) {
    throw new Error('McpManager not initialized. Call initMcpManager() first.');
  }
  return manager;
}

export function hasMcpManager(): boolean {
  return manager !== null;
}

export class McpManager {
  constructor(
    private readonly storage: Storage,
    private readonly injector: McpConfigInjector,
    private readonly scanner: WorkspaceMcpScanner,
  ) {}

  /**
   * Register a new MCP server, inject into target configs, and emit event.
   */
  add(input: CreateMcpServerInput): McpServer {
    const server = this.storage.mcpServers.create(input);

    // Inject into target configs if active
    if (server.status === 'active') {
      this.injectToProfiles(server);
    }

    emitEvent('mcp:server_added', {
      id: server.id,
      name: server.name,
      slug: server.slug,
      transport: server.transport,
      source: server.source,
    });

    return server;
  }

  /**
   * Remove an MCP server, remove from target configs, and emit event.
   */
  remove(id: string): void {
    const server = this.storage.mcpServers.getById(id);
    if (!server) throw new McpServerNotFoundError(id);

    // Remove from target configs
    this.removeFromProfiles(server);

    this.storage.mcpServers.delete(id);

    emitEvent('mcp:server_removed', {
      id: server.id,
      slug: server.slug,
    });
  }

  /**
   * Enable an MCP server and inject into target configs.
   */
  enable(id: string): McpServer {
    const server = this.storage.mcpServers.getById(id);
    if (!server) throw new McpServerNotFoundError(id);

    const previousStatus = server.status;
    const updated = this.storage.mcpServers.update(id, { status: 'active' });
    if (!updated) throw new McpServerNotFoundError(id);

    this.injectToProfiles(updated);

    emitEvent('mcp:server_status_changed', {
      id: updated.id,
      slug: updated.slug,
      previousStatus,
      newStatus: 'active',
    });

    return updated;
  }

  /**
   * Disable an MCP server and remove from target configs.
   */
  disable(id: string): McpServer {
    const server = this.storage.mcpServers.getById(id);
    if (!server) throw new McpServerNotFoundError(id);

    const previousStatus = server.status;
    const updated = this.storage.mcpServers.update(id, { status: 'disabled' });
    if (!updated) throw new McpServerNotFoundError(id);

    this.removeFromProfiles(server);

    emitEvent('mcp:server_status_changed', {
      id: updated.id,
      slug: updated.slug,
      previousStatus,
      newStatus: 'disabled',
    });

    return updated;
  }

  /**
   * Approve a quarantined MCP server and re-inject into config.
   */
  approve(id: string): McpServer {
    const server = this.storage.mcpServers.getById(id);
    if (!server) throw new McpServerNotFoundError(id);

    const previousStatus = server.status;
    const updated = this.storage.mcpServers.update(id, { status: 'active' });
    if (!updated) throw new McpServerNotFoundError(id);

    this.injectToProfiles(updated);

    emitEvent('mcp:server_status_changed', {
      id: updated.id,
      slug: updated.slug,
      previousStatus,
      newStatus: 'active',
    });

    return updated;
  }

  /**
   * Get all MCP servers, with optional filters.
   */
  getAll(filter?: { profileId?: string; source?: string; status?: string }): McpServer[] {
    if (filter?.profileId) return this.storage.mcpServers.getByProfile(filter.profileId);
    if (filter?.source) return this.storage.mcpServers.getBySource(filter.source);
    if (filter?.status) return this.storage.mcpServers.getByStatus(filter.status);
    return this.storage.mcpServers.getAll();
  }

  /**
   * Get a single MCP server by ID.
   */
  getById(id: string): McpServer | null {
    return this.storage.mcpServers.getById(id);
  }

  /**
   * Get MCP servers for a profile.
   */
  getByProfile(profileId: string): McpServer[] {
    return this.storage.mcpServers.getByProfile(profileId);
  }

  /**
   * Apply a managed push from cloud/external source.
   * Deletes all existing managed servers from the source, then creates new ones.
   */
  applyManagedPush(servers: CreateMcpServerInput[], source: string): { added: number; removed: number } {
    const removed = this.storage.mcpServers.deleteManagedBySource(source);

    let added = 0;
    for (const input of servers) {
      this.storage.mcpServers.createManaged(input, source);
      added++;
    }

    // Sync managed servers to all profiles
    this.syncManagedToProfiles();

    emitEvent('mcp:cloud_sync', {
      source,
      added,
      removed,
      updated: 0,
    });

    return { added, removed };
  }

  /**
   * Re-inject all managed MCP servers to all target profiles.
   */
  syncManagedToProfiles(): void {
    const profiles = this.storage.profiles.getAll();
    for (const profile of profiles) {
      if (profile.id) {
        this.injector.syncProfile(profile.id);
      }
    }
  }

  /**
   * Force a re-scan of all workspace configs.
   */
  scanWorkspaces(): void {
    this.scanner.scanAllProfiles();
  }

  private injectToProfiles(server: McpServer): void {
    const profiles = this.storage.profiles.getAll();
    for (const profile of profiles) {
      if (server.profileId === null || server.profileId === profile.id) {
        if (this.isTargetSupported(server, profile.presetId)) {
          this.injector.inject(server, profile.id);
        }
      }
    }
  }

  private removeFromProfiles(server: McpServer): void {
    const profiles = this.storage.profiles.getAll();
    for (const profile of profiles) {
      if (server.profileId === null || server.profileId === profile.id) {
        this.injector.remove(server.slug, profile.id);
      }
    }
  }

  private isTargetSupported(server: McpServer, presetId?: string): boolean {
    if (server.supportedTargets.length === 0) return true;
    if (!presetId) return false;
    return server.supportedTargets.includes(presetId);
  }
}
