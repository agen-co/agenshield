/**
 * Skills Manager
 *
 * Orchestrates multiple SkillSourceAdapters, providing unified tool discovery,
 * skill generation, versioning (SHA-based), and sync across all sources.
 */

import * as crypto from 'node:crypto';
import type {
  SkillSourceAdapter,
  SkillDefinition,
  SkillFile,
  DiscoveredTool,
  RequiredBinary,
  AdapterInstructions,
  SkillVersionStore,
  SkillInstaller,
  AdapterSyncResult,
  TargetPlatform,
  ToolQuery,
  SkillsManagerEvent,
} from './adapters/types.js';

export interface SkillsManagerOptions {
  versionStore: SkillVersionStore;
  installer: SkillInstaller;
  onEvent?: (event: SkillsManagerEvent) => void;
}

/**
 * Compute SHA-256 from an array of SkillFile objects.
 * Files are sorted by name for determinism, matching the on-disk hash logic
 * in watchers/skills.ts computeSkillHash().
 */
export function computeSkillDefinitionSha(files: SkillFile[]): string {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const hash = crypto.createHash('sha256');
  for (const file of sorted) {
    hash.update(file.name);
    hash.update(file.content);
  }
  return hash.digest('hex');
}

export class SkillsManager {
  private sources = new Map<string, SkillSourceAdapter>();
  private versionStore: SkillVersionStore;
  private installer: SkillInstaller;
  private onEvent?: (event: SkillsManagerEvent) => void;

  constructor(options: SkillsManagerOptions) {
    this.versionStore = options.versionStore;
    this.installer = options.installer;
    this.onEvent = options.onEvent;
  }

  // ─── Source Management ──────────────────────────────────────

  async registerSource(source: SkillSourceAdapter): Promise<void> {
    if (this.sources.has(source.id)) {
      throw new Error(`Source adapter "${source.id}" is already registered`);
    }
    if (source.initialize) {
      await source.initialize();
    }
    this.sources.set(source.id, source);
    this.emit({ type: 'source:registered', sourceId: source.id });
  }

  async unregisterSource(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (!source) return;
    if (source.dispose) {
      await source.dispose();
    }
    this.sources.delete(id);
    this.emit({ type: 'source:removed', sourceId: id });
  }

  getSource(id: string): SkillSourceAdapter | undefined {
    return this.sources.get(id);
  }

  listSources(): SkillSourceAdapter[] {
    return Array.from(this.sources.values());
  }

  // ─── Aggregated Queries ─────────────────────────────────────

  async discoverTools(query?: ToolQuery): Promise<DiscoveredTool[]> {
    const results: DiscoveredTool[] = [];
    const promises = Array.from(this.sources.values()).map(async (source) => {
      try {
        if (await source.isAvailable()) {
          return source.getTools(query);
        }
      } catch (err) {
        console.warn(`[SkillsManager] getTools failed for source "${source.id}":`, (err as Error).message);
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
    const promises = Array.from(this.sources.values()).map(async (source) => {
      try {
        if (await source.isAvailable()) {
          return source.getSkillsFor(target);
        }
      } catch (err) {
        console.warn(`[SkillsManager] getSkillsFor failed for source "${source.id}":`, (err as Error).message);
      }
      return [];
    });
    const arrays = await Promise.all(promises);
    for (const defs of arrays) {
      results.push(...defs);
    }
    return results;
  }

  async getAllBins(): Promise<RequiredBinary[]> {
    const binMap = new Map<string, RequiredBinary>();
    const promises = Array.from(this.sources.values()).map(async (source) => {
      try {
        if (await source.isAvailable()) {
          return source.getBins();
        }
      } catch (err) {
        console.warn(`[SkillsManager] getBins failed for source "${source.id}":`, (err as Error).message);
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
    for (const source of this.sources.values()) {
      try {
        const def = await source.getSkillFiles(skillId);
        if (def) return def;
      } catch {
        // Try next source
      }
    }
    return null;
  }

  async getInstructions(): Promise<AdapterInstructions[]> {
    const results: AdapterInstructions[] = [];
    const promises = Array.from(this.sources.values()).map(async (source) => {
      try {
        if (await source.isAvailable()) {
          return source.getInstructions();
        }
      } catch (err) {
        console.warn(`[SkillsManager] getInstructions failed for source "${source.id}":`, (err as Error).message);
      }
      return [];
    });
    const arrays = await Promise.all(promises);
    for (const instructions of arrays) {
      results.push(...instructions);
    }
    // Sort by priority (lower = earlier), default 100
    results.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    return results;
  }

  // ─── Sync ───────────────────────────────────────────────────

  /**
   * Sync one source: fetches its current definitions, diffs against
   * installed versions, installs/updates/removes as needed.
   */
  async syncSource(sourceId: string, target: TargetPlatform): Promise<AdapterSyncResult> {
    const result: AdapterSyncResult = { installed: [], removed: [], updated: [], errors: [] };

    const source = this.sources.get(sourceId);
    if (!source) {
      result.errors.push(`Source "${sourceId}" not registered`);
      return result;
    }

    let desired: SkillDefinition[];
    try {
      desired = await source.getSkillsFor(target);
    } catch (err) {
      result.errors.push(`Failed to get skills from "${sourceId}": ${(err as Error).message}`);
      return result;
    }

    const desiredMap = new Map(desired.map(d => [d.skillId, d]));
    const installed = this.versionStore.listBySource(sourceId);
    const installedMap = new Map(installed.map(i => [i.skillId, i]));

    // Install new or update stale skills
    for (const [skillId, def] of desiredMap) {
      const existing = installedMap.get(skillId);

      if (!existing) {
        // New skill — install
        try {
          await this.installer.install(def, {
            createWrapper: !!def.metadata?.['createWrapper'],
            addPolicy: true,
            injectTag: true,
            stripEnv: true,
          });
          this.versionStore.setInstalled({
            skillId: def.skillId,
            version: def.version,
            sha: def.sha,
            sourceId,
            installedAt: new Date().toISOString(),
            trusted: def.trusted,
          });
          result.installed.push(skillId);
          this.emit({ type: 'skill:installed', skillId, sourceId });
        } catch (err) {
          result.errors.push(`install ${skillId}: ${(err as Error).message}`);
        }
      } else if (existing.sha !== def.sha) {
        // SHA mismatch — update
        try {
          await this.installer.install(def, {
            createWrapper: !!def.metadata?.['createWrapper'],
            addPolicy: true,
            injectTag: true,
            stripEnv: true,
          });
          this.versionStore.setInstalled({
            skillId: def.skillId,
            version: def.version,
            sha: def.sha,
            sourceId,
            installedAt: new Date().toISOString(),
            trusted: def.trusted,
          });
          result.updated.push(skillId);
          this.emit({ type: 'skill:updated', skillId, sourceId });
        } catch (err) {
          result.errors.push(`update ${skillId}: ${(err as Error).message}`);
        }
      }
      // else: SHA matches — skip
    }

    // Remove orphaned skills (installed but no longer desired)
    for (const [skillId] of installedMap) {
      if (!desiredMap.has(skillId)) {
        try {
          await this.installer.uninstall(skillId, {
            removeWrapper: true,
            removePolicy: true,
          });
          this.versionStore.removeInstalled(skillId);
          result.removed.push(skillId);
          this.emit({ type: 'skill:removed', skillId, sourceId });
        } catch (err) {
          result.errors.push(`remove ${skillId}: ${(err as Error).message}`);
        }
      }
    }

    this.emit({ type: 'skill:sync-complete', sourceId, result });
    return result;
  }

  /**
   * Sync all registered sources.
   */
  async syncAll(target: TargetPlatform): Promise<AdapterSyncResult> {
    const combined: AdapterSyncResult = { installed: [], removed: [], updated: [], errors: [] };

    for (const source of this.sources.values()) {
      const result = await this.syncSource(source.id, target);
      combined.installed.push(...result.installed);
      combined.removed.push(...result.removed);
      combined.updated.push(...result.updated);
      combined.errors.push(...result.errors);
    }

    return combined;
  }

  // ─── Helpers ────────────────────────────────────────────────

  /**
   * Check if a specific skill needs updating based on SHA comparison.
   */
  needsUpdate(skillId: string, currentSha: string): boolean {
    const installed = this.versionStore.getInstalled(skillId);
    if (!installed) return true;
    return installed.sha !== currentSha;
  }

  private emit(event: SkillsManagerEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Don't let event handler errors crash the manager
    }
  }
}
