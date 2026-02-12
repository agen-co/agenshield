/**
 * Sync Service
 *
 * Orchestrates multiple SkillSourceAdapters, providing unified tool discovery,
 * skill generation, versioning (SHA-based), and sync across all sources.
 *
 * Replaces the old SkillsManager from @agenshield/skills, but backed by
 * SQLite (SkillsRepository) + DeployService instead of JSON VersionStore + SkillInstaller.
 */

import type { SkillsRepository } from '@agenshield/storage';
import type {
  SkillSourceAdapter,
  SkillDefinition,
  DiscoveredTool,
  RequiredBinary,
  AdapterInstructions,
  AdapterSyncResult,
  TargetPlatform,
  ToolQuery,
  SkillsManagerEvent,
} from '@agenshield/ipc';
import type { SkillManager } from '../manager';

export interface SyncServiceOptions {
  onEvent?: (event: SkillsManagerEvent) => void;
}

export class SyncService {
  private sources = new Map<string, SkillSourceAdapter>();
  private readonly manager: SkillManager;
  private readonly skills: SkillsRepository;
  private onEvent?: (event: SkillsManagerEvent) => void;

  constructor(manager: SkillManager, skills: SkillsRepository, options?: SyncServiceOptions) {
    this.manager = manager;
    this.skills = skills;
    this.onEvent = options?.onEvent;
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
        console.warn(`[SyncService] getTools failed for source "${source.id}":`, (err as Error).message);
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
        console.warn(`[SyncService] getSkillsFor failed for source "${source.id}":`, (err as Error).message);
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
        console.warn(`[SyncService] getBins failed for source "${source.id}":`, (err as Error).message);
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
        console.warn(`[SyncService] getInstructions failed for source "${source.id}":`, (err as Error).message);
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
   * installed versions in SQLite, installs/updates/removes as needed.
   *
   * Uses SkillManager.uploader + approveSkill + revokeSkill for lifecycle,
   * so all deploy adapters, events, and DB records are handled correctly.
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

    // Find currently installed skills from this source adapter in the DB.
    // Adapter-synced skills use source='integration' + remoteId=sourceId.
    // Filter by remoteId to distinguish between different adapters.
    const allIntegrationSkills = this.skills.getAll({ source: 'integration' });
    const installedMap = new Map(
      allIntegrationSkills
        .filter(s => s.remoteId === sourceId)
        .map(s => [s.slug, s]),
    );

    // Install new or update stale skills
    for (const [skillId, def] of desiredMap) {
      const existingSkill = installedMap.get(skillId);

      if (!existingSkill) {
        // New skill — upload, approve, install
        try {
          this.manager.uploadFiles({
            name: def.name,
            slug: def.skillId,
            version: def.version,
            author: def.author,
            description: def.description,
            tags: def.tags,
            files: def.files.map(f => ({
              relativePath: f.name,
              content: Buffer.from(f.content, 'utf-8'),
            })),
          });

          // Tag skill with source='integration' + remoteId=sourceId for sync tracking
          const skill = this.skills.getBySlug(def.skillId);
          if (skill) {
            this.skills.update(skill.id, { source: 'integration' as const, remoteId: sourceId });

            // Mark as trusted if source says so
            const version = this.skills.getLatestVersion(skill.id);
            if (version && def.trusted) {
              this.skills.approveVersion(version.id);
            }
          }

          await this.manager.approveSkill(def.skillId);
          result.installed.push(skillId);
          this.emit({ type: 'skill:installed', skillId, sourceId });
        } catch (err) {
          result.errors.push(`install ${skillId}: ${(err as Error).message}`);
        }
      } else {
        // Existing skill — check SHA to see if update is needed
        const latestVersion = this.skills.getLatestVersion(existingSkill.id);
        const currentHash = latestVersion?.contentHash;

        if (currentHash !== def.sha) {
          // SHA mismatch — upload new version, approve, re-deploy
          try {
            this.manager.uploadFiles({
              name: def.name,
              slug: def.skillId,
              version: def.version,
              author: def.author,
              description: def.description,
              tags: def.tags,
              files: def.files.map(f => ({
                relativePath: f.name,
                content: Buffer.from(f.content, 'utf-8'),
              })),
            });

            // Update source ownership
            this.skills.update(existingSkill.id, { source: 'integration' as const, remoteId: sourceId });

            const version = this.skills.getLatestVersion(existingSkill.id);
            if (version && def.trusted) {
              this.skills.approveVersion(version.id);
            }

            await this.manager.approveSkill(def.skillId);
            result.updated.push(skillId);
            this.emit({ type: 'skill:updated', skillId, sourceId });
          } catch (err) {
            result.errors.push(`update ${skillId}: ${(err as Error).message}`);
          }
        }
        // else: SHA matches — skip
      }
    }

    // Remove orphaned skills (installed from this source but no longer desired)
    for (const [slug, skill] of installedMap) {
      if (!desiredMap.has(slug)) {
        try {
          await this.manager.revokeSkill(slug);
          this.skills.delete(skill.id);
          result.removed.push(slug);
          this.emit({ type: 'skill:removed', skillId: slug, sourceId });
        } catch (err) {
          result.errors.push(`remove ${slug}: ${(err as Error).message}`);
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
      const r = await this.syncSource(source.id, target);
      combined.installed.push(...r.installed);
      combined.removed.push(...r.removed);
      combined.updated.push(...r.updated);
      combined.errors.push(...r.errors);
    }

    return combined;
  }

  // ─── Helpers ────────────────────────────────────────────────

  private emit(event: SkillsManagerEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Don't let event handler errors crash the service
    }
  }
}
