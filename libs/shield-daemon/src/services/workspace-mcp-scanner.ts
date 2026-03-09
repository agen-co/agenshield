/**
 * Workspace MCP Scanner
 *
 * Monitors target config files for unauthorized MCP server entries.
 * Detects MCP servers not registered in the DB and flags/quarantines them.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { McpServer } from '@agenshield/ipc';
import type { Storage } from '@agenshield/storage';
import { emitEvent } from '../events/emitter';

export interface ScannerDeps {
  storage: Storage;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  configDir: string;
}

type EnforcementMode = 'alert' | 'quarantine';

export class WorkspaceMcpScanner {
  private readonly storage: Storage;
  private readonly logger: ScannerDeps['logger'];
  private readonly configDir: string;

  private pollTimer: NodeJS.Timeout | null = null;
  private watchers = new Map<string, fs.FSWatcher>();
  private scanDebounceTimers = new Map<string, NodeJS.Timeout>();
  private stopped = false;
  private enforcementMode: EnforcementMode = 'alert';

  constructor(deps: ScannerDeps) {
    this.storage = deps.storage;
    this.logger = deps.logger;
    this.configDir = deps.configDir;
  }

  /**
   * Set the enforcement mode for unauthorized MCP server detection.
   */
  setEnforcementMode(mode: EnforcementMode): void {
    this.enforcementMode = mode;
  }

  /**
   * Start monitoring with polling fallback.
   */
  start(pollIntervalMs = 30_000): void {
    this.stopped = false;

    // Initial scan
    this.scanAllProfiles();

    // Set up watchers for known config files
    this.setupWatchers();

    // Polling fallback
    this.pollTimer = setInterval(() => {
      if (!this.stopped) {
        this.scanAllProfiles();
      }
    }, pollIntervalMs);
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    this.stopped = true;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    for (const [, timer] of this.scanDebounceTimers) {
      clearTimeout(timer);
    }
    this.scanDebounceTimers.clear();
  }

  /**
   * Force a re-scan of all profiles.
   */
  scanAllProfiles(): void {
    try {
      const profiles = this.storage.profiles.getAll();
      for (const profile of profiles) {
        if (profile.agentHomeDir && profile.presetId) {
          this.scanProfile(profile.id, profile.agentHomeDir, profile.presetId);
        }
      }
    } catch (err) {
      this.logger.error('[WorkspaceMcpScanner] Error scanning profiles:', err);
    }
  }

  /**
   * Scan a single profile's config for unauthorized MCP servers.
   */
  scanProfile(profileId: string, agentHomeDir: string, presetId: string): void {
    const configPath = this.getConfigPath(agentHomeDir, presetId);
    if (!configPath || !fs.existsSync(configPath)) return;

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;

      const approvedSlugs = new Set(
        this.storage.mcpServers.getAll()
          .filter((s) => s.status === 'active' && (s.profileId === null || s.profileId === profileId))
          .map((s) => s.slug),
      );

      for (const slug of Object.keys(mcpServers)) {
        if (!approvedSlugs.has(slug)) {
          this.handleUnauthorized(slug, configPath, mcpServers[slug] as Record<string, unknown>);
        }
      }
    } catch (err) {
      this.logger.error(`[WorkspaceMcpScanner] Error scanning ${configPath}:`, err);
    }
  }

  /**
   * Approve a quarantined MCP server and re-inject it.
   */
  approveServer(id: string): McpServer | null {
    const server = this.storage.mcpServers.getById(id);
    if (!server || server.status !== 'blocked') return null;

    return this.storage.mcpServers.update(id, { status: 'active' });
  }

  private handleUnauthorized(slug: string, configPath: string, config: Record<string, unknown>): void {
    // Check if already tracked as blocked/pending
    const existing = this.storage.mcpServers.getBySlug(slug);
    if (existing && (existing.status === 'blocked' || existing.status === 'pending')) return;

    const transport = this.inferTransport(config);

    if (this.enforcementMode === 'quarantine') {
      // Create blocked record in DB
      this.storage.mcpServers.create({
        name: slug,
        slug,
        transport,
        url: (config.url as string) ?? null,
        command: (config.command as string) ?? null,
        args: (config.args as string[]) ?? [],
        env: (config.env as Record<string, string>) ?? {},
        headers: (config.headers as Record<string, string>) ?? {},
        source: 'workspace',
        status: 'blocked',
        configJson: config,
      });

      // Remove from config file
      this.removeFromConfig(configPath, slug);

      emitEvent('mcp:unauthorized_detected', {
        slug,
        configPath,
        transport,
        action: 'quarantine',
      });

      this.logger.warn(`[WorkspaceMcpScanner] Quarantined unauthorized MCP server: ${slug}`);
    } else {
      // Alert only — create pending record
      this.storage.mcpServers.create({
        name: slug,
        slug,
        transport,
        url: (config.url as string) ?? null,
        command: (config.command as string) ?? null,
        args: (config.args as string[]) ?? [],
        env: (config.env as Record<string, string>) ?? {},
        headers: (config.headers as Record<string, string>) ?? {},
        source: 'workspace',
        status: 'pending',
        configJson: config,
      });

      emitEvent('mcp:unauthorized_detected', {
        slug,
        configPath,
        transport,
        action: 'alert',
      });

      this.logger.warn(`[WorkspaceMcpScanner] Detected unauthorized MCP server: ${slug}`);
    }
  }

  private inferTransport(config: Record<string, unknown>): 'stdio' | 'sse' | 'streamable-http' {
    if (config.command) return 'stdio';
    if (config.url) return 'sse';
    return 'stdio';
  }

  private removeFromConfig(configPath: string, slug: string): void {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      const servers = config.mcpServers as Record<string, unknown> | undefined;
      if (servers && slug in servers) {
        delete servers[slug];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o644 });
      }
    } catch (err) {
      this.logger.error(`[WorkspaceMcpScanner] Failed to remove ${slug} from ${configPath}:`, err);
    }
  }

  private getConfigPath(agentHomeDir: string, presetId: string): string | null {
    switch (presetId) {
      case 'claude-code':
        return path.join(agentHomeDir, '.claude', 'settings.json');
      case 'openclaw': {
        const primary = path.join(agentHomeDir, '.openclaw', 'mcp.json');
        const fallback = path.join(agentHomeDir, '.config', 'openclaw', 'mcp.json');
        return fs.existsSync(primary) ? primary : fallback;
      }
      default:
        return null;
    }
  }

  private setupWatchers(): void {
    const profiles = this.storage.profiles.getAll();
    for (const profile of profiles) {
      if (profile.agentHomeDir && profile.presetId) {
        const configPath = this.getConfigPath(profile.agentHomeDir, profile.presetId);
        if (configPath && fs.existsSync(configPath)) {
          this.watchConfigFile(configPath, profile.id, profile.agentHomeDir, profile.presetId);
        }
      }
    }
  }

  private watchConfigFile(configPath: string, profileId: string, agentHomeDir: string, presetId: string): void {
    if (this.watchers.has(configPath)) return;

    try {
      const watcher = fs.watch(configPath, () => {
        this.debounceScan(configPath, profileId, agentHomeDir, presetId);
      });
      this.watchers.set(configPath, watcher);
    } catch {
      // File may not be watchable — polling fallback handles it
    }
  }

  private debounceScan(configPath: string, profileId: string, agentHomeDir: string, presetId: string): void {
    const existing = this.scanDebounceTimers.get(configPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.scanDebounceTimers.delete(configPath);
      if (!this.stopped) {
        this.scanProfile(profileId, agentHomeDir, presetId);
      }
    }, 500);

    this.scanDebounceTimers.set(configPath, timer);
  }
}
