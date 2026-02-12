/**
 * MCP Skill Source
 *
 * A single generic SkillSourceAdapter that manages multiple MCP server
 * connections. Each connection provides its own tool discovery, skill
 * generation, binary requirements, and instruction logic.
 *
 * AgenCo is the first connection, but the architecture supports any
 * MCP-compatible server (future: custom MCP integrations, etc.).
 */

import type {
  SkillSourceAdapter,
  SkillDefinition,
  DiscoveredTool,
  RequiredBinary,
  AdapterInstructions,
  TargetPlatform,
  ToolQuery,
} from '@agenshield/ipc';

/**
 * Configuration for a single MCP connection within the MCPSkillSource.
 * Each connection implements its own delegate methods.
 */
export interface MCPConnectionConfig {
  /** Unique connection identifier (e.g. 'agenco') */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Whether skills from this connection are trusted (skip vulnerability analysis) */
  trusted: boolean;

  // ─── Delegate methods ──────────────────────────────────────
  getTools(query?: ToolQuery): Promise<DiscoveredTool[]>;
  getSkillsFor(target: TargetPlatform): Promise<SkillDefinition[]>;
  getBins(): Promise<RequiredBinary[]>;
  getSkillFiles(skillId: string): Promise<SkillDefinition | null>;
  getInstructions(): Promise<AdapterInstructions[]>;
  isAvailable(): Promise<boolean>;

  initialize?(): Promise<void>;
  dispose?(): Promise<void>;
}

export class MCPSkillSource implements SkillSourceAdapter {
  readonly id = 'mcp';
  readonly displayName = 'MCP Servers';
  readonly trusted = true;

  private connections = new Map<string, MCPConnectionConfig>();

  // ─── Connection Management ───────────────────────────────────

  async addConnection(config: MCPConnectionConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      throw new Error(`MCP connection "${config.id}" is already registered`);
    }
    if (config.initialize) {
      await config.initialize();
    }
    this.connections.set(config.id, config);
  }

  async removeConnection(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) return;
    if (conn.dispose) {
      await conn.dispose();
    }
    this.connections.delete(id);
  }

  getConnection(id: string): MCPConnectionConfig | undefined {
    return this.connections.get(id);
  }

  listConnections(): MCPConnectionConfig[] {
    return Array.from(this.connections.values());
  }

  // ─── SkillSourceAdapter Implementation ───────────────────────

  async getTools(query?: ToolQuery): Promise<DiscoveredTool[]> {
    const results: DiscoveredTool[] = [];
    const promises = Array.from(this.connections.values()).map(async (conn) => {
      try {
        if (await conn.isAvailable()) {
          return conn.getTools(query);
        }
      } catch (err) {
        console.warn(`[MCPSkillSource] getTools failed for connection "${conn.id}":`, (err as Error).message);
      }
      return [];
    });
    const arrays = await Promise.all(promises);
    for (const tools of arrays) {
      results.push(...tools);
    }
    return query?.limit ? results.slice(0, query.limit) : results;
  }

  async getSkillsFor(target: TargetPlatform): Promise<SkillDefinition[]> {
    const results: SkillDefinition[] = [];
    const promises = Array.from(this.connections.values()).map(async (conn) => {
      try {
        if (await conn.isAvailable()) {
          return conn.getSkillsFor(target);
        }
      } catch (err) {
        console.warn(`[MCPSkillSource] getSkillsFor failed for connection "${conn.id}":`, (err as Error).message);
      }
      return [];
    });
    const arrays = await Promise.all(promises);
    for (const defs of arrays) {
      results.push(...defs);
    }
    return results;
  }

  async getBins(): Promise<RequiredBinary[]> {
    const binMap = new Map<string, RequiredBinary>();
    const promises = Array.from(this.connections.values()).map(async (conn) => {
      try {
        if (await conn.isAvailable()) {
          return conn.getBins();
        }
      } catch (err) {
        console.warn(`[MCPSkillSource] getBins failed for connection "${conn.id}":`, (err as Error).message);
      }
      return [];
    });
    const arrays = await Promise.all(promises);
    for (const bins of arrays) {
      for (const bin of bins) {
        if (!binMap.has(bin.name)) {
          binMap.set(bin.name, bin);
        }
      }
    }
    return Array.from(binMap.values());
  }

  async getSkillFiles(skillId: string): Promise<SkillDefinition | null> {
    for (const conn of this.connections.values()) {
      try {
        const def = await conn.getSkillFiles(skillId);
        if (def) return def;
      } catch {
        // Try next connection
      }
    }
    return null;
  }

  async getInstructions(): Promise<AdapterInstructions[]> {
    const results: AdapterInstructions[] = [];
    const promises = Array.from(this.connections.values()).map(async (conn) => {
      try {
        if (await conn.isAvailable()) {
          return conn.getInstructions();
        }
      } catch (err) {
        console.warn(`[MCPSkillSource] getInstructions failed for connection "${conn.id}":`, (err as Error).message);
      }
      return [];
    });
    const arrays = await Promise.all(promises);
    for (const instructions of arrays) {
      results.push(...instructions);
    }
    results.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    return results;
  }

  async isAvailable(): Promise<boolean> {
    for (const conn of this.connections.values()) {
      try {
        if (await conn.isAvailable()) return true;
      } catch {
        // Check next
      }
    }
    return false;
  }

  async initialize(): Promise<void> {
    // Connections are initialized when added via addConnection()
  }

  async dispose(): Promise<void> {
    for (const conn of this.connections.values()) {
      if (conn.dispose) {
        try {
          await conn.dispose();
        } catch {
          // Best-effort cleanup
        }
      }
    }
    this.connections.clear();
  }
}
