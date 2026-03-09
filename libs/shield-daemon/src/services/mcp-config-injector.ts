/**
 * MCP Config Injector
 *
 * Writes/removes MCP server entries in target platform config files
 * (e.g. ~/.claude/settings.json, ~/.openclaw/mcp.json).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { McpServer } from '@agenshield/ipc';
import type { Storage } from '@agenshield/storage';

export interface InjectorDeps {
  storage: Storage;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

interface TargetContext {
  agentHomeDir: string;
  presetId: string;
}

interface ConfigFileInfo {
  path: string;
  key: string;
}

export class McpConfigInjector {
  private readonly storage: Storage;
  private readonly logger: InjectorDeps['logger'];

  constructor(deps: InjectorDeps) {
    this.storage = deps.storage;
    this.logger = deps.logger;
  }

  /**
   * Inject an MCP server entry into the target config file.
   */
  inject(server: McpServer, profileId: string): { success: boolean; error?: string } {
    try {
      const ctx = this.resolveTargetContext(profileId);
      if (!ctx) return { success: false, error: 'No target context for profile' };

      const configFile = this.getConfigFileInfo(ctx);
      if (!configFile) return { success: false, error: `Unsupported target: ${ctx.presetId}` };

      const config = this.loadConfig(configFile.path);
      if (!config[configFile.key]) {
        config[configFile.key] = {};
      }

      const entry = this.buildEntry(server);
      (config[configFile.key] as Record<string, unknown>)[server.slug] = entry;
      this.writeConfig(configFile.path, config);

      this.logger.info(`[McpConfigInjector] Injected ${server.slug} into ${configFile.path}`);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[McpConfigInjector] Failed to inject ${server.slug}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Remove an MCP server entry from the target config file.
   */
  remove(slug: string, profileId: string): { success: boolean; error?: string } {
    try {
      const ctx = this.resolveTargetContext(profileId);
      if (!ctx) return { success: false, error: 'No target context for profile' };

      const configFile = this.getConfigFileInfo(ctx);
      if (!configFile) return { success: false, error: `Unsupported target: ${ctx.presetId}` };

      if (!fs.existsSync(configFile.path)) return { success: true };

      const config = this.loadConfig(configFile.path);
      const servers = config[configFile.key] as Record<string, unknown> | undefined;
      if (servers && slug in servers) {
        delete servers[slug];
        this.writeConfig(configFile.path, config);
        this.logger.info(`[McpConfigInjector] Removed ${slug} from ${configFile.path}`);
      }

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[McpConfigInjector] Failed to remove ${slug}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Sync all enabled MCP servers to a profile's target config.
   */
  syncProfile(profileId: string): { success: boolean; synced: number; error?: string } {
    const servers = this.storage.mcpServers.getEnabled();
    const profileServers = servers.filter(
      (s) => s.profileId === null || s.profileId === profileId,
    );

    let synced = 0;
    for (const server of profileServers) {
      const result = this.inject(server, profileId);
      if (result.success) synced++;
    }

    return { success: true, synced };
  }

  /**
   * Read current MCP server entries from a target config file.
   */
  readCurrentConfig(profileId: string): Record<string, unknown> {
    const ctx = this.resolveTargetContext(profileId);
    if (!ctx) return {};

    const configFile = this.getConfigFileInfo(ctx);
    if (!configFile || !fs.existsSync(configFile.path)) return {};

    const config = this.loadConfig(configFile.path);
    return (config[configFile.key] as Record<string, unknown>) ?? {};
  }

  private resolveTargetContext(profileId: string): TargetContext | null {
    const profile = this.storage.profiles.getById(profileId);
    if (!profile) return null;
    if (!profile.agentHomeDir || !profile.presetId) return null;
    return { agentHomeDir: profile.agentHomeDir, presetId: profile.presetId };
  }

  private getConfigFileInfo(ctx: TargetContext): ConfigFileInfo | null {
    switch (ctx.presetId) {
      case 'claude-code':
        return {
          path: path.join(ctx.agentHomeDir, '.claude', 'settings.json'),
          key: 'mcpServers',
        };
      case 'openclaw': {
        const primary = path.join(ctx.agentHomeDir, '.openclaw', 'mcp.json');
        const fallback = path.join(ctx.agentHomeDir, '.config', 'openclaw', 'mcp.json');
        return {
          path: fs.existsSync(primary) ? primary : fallback,
          key: 'mcpServers',
        };
      }
      default:
        return null;
    }
  }

  private buildEntry(server: McpServer): Record<string, unknown> {
    if (server.transport === 'stdio') {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args.length > 0) entry.args = server.args;
      if (Object.keys(server.env).length > 0) entry.env = server.env;
      return entry;
    }

    // SSE or streamable-http
    const entry: Record<string, unknown> = {};
    if (server.url) entry.url = server.url;
    if (Object.keys(server.headers).length > 0) entry.headers = server.headers;
    return entry;
  }

  private loadConfig(configPath: string): Record<string, unknown> {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw) as Record<string, unknown>;
      }
    } catch {
      // Fall through to create new
    }
    return {};
  }

  private writeConfig(configPath: string, config: Record<string, unknown>): void {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o644 });
  }
}
