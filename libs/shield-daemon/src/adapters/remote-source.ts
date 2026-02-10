/**
 * Remote Skill Source
 *
 * SkillSourceAdapter that fetches skills from remote registries.
 * Currently wraps the ClawHub marketplace (skills.agentfront.dev / Convex).
 *
 * Remote skills are NOT trusted — they always go through vulnerability
 * analysis before installation.
 */

import { computeSkillDefinitionSha } from '@agenshield/skills';
import type {
  SkillSourceAdapter,
  SkillDefinition,
  SkillFile,
  DiscoveredTool,
  RequiredBinary,
  AdapterInstructions,
  TargetPlatform,
  ToolQuery,
} from '@agenshield/skills';
import type { MarketplaceSkill, MarketplaceSkillFile } from '@agenshield/ipc';

/**
 * Dependencies injected from the daemon (avoids circular imports).
 */
export interface RemoteSourceDeps {
  searchMarketplace: (query: string) => Promise<MarketplaceSkill[]>;
  getMarketplaceSkill: (slug: string) => Promise<MarketplaceSkill>;
  downloadAndExtractZip: (slug: string) => Promise<MarketplaceSkillFile[]>;
  listDownloadedSkills: () => Array<{
    slug: string;
    name: string;
    author: string;
    version: string;
    description: string;
    tags: string[];
    wasInstalled?: boolean;
  }>;
}

/**
 * Convert MarketplaceSkillFile[] to SkillFile[] (drop `type` field, keep name/content).
 */
function toSkillFiles(files: MarketplaceSkillFile[]): SkillFile[] {
  return files.map(f => ({
    name: f.name,
    content: f.content,
    type: f.type,
  }));
}

/**
 * Extract bin requirements from SKILL.md frontmatter (simple regex parser).
 */
function extractBinsFromContent(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];

  const yaml = match[1];
  const binsSection = yaml.match(/requires:\s*\n\s+bins:\s*\n((?:\s+-\s+.+\n?)*)/);
  if (!binsSection) return [];

  const bins: string[] = [];
  const binLines = binsSection[1].matchAll(/^\s+-\s+(.+)$/gm);
  for (const m of binLines) {
    bins.push(m[1].trim());
  }
  return bins;
}

export class RemoteSkillSource implements SkillSourceAdapter {
  readonly id = 'registry';
  readonly displayName = 'Skill Registry';
  readonly trusted = false;

  private deps: RemoteSourceDeps;

  constructor(deps: RemoteSourceDeps) {
    this.deps = deps;
  }

  async getTools(query?: ToolQuery): Promise<DiscoveredTool[]> {
    if (!query?.search) {
      // Without a search query, return tools from locally cached downloads
      const downloaded = this.deps.listDownloadedSkills();
      return downloaded.map(d => ({
        id: d.slug,
        name: d.name,
        description: d.description,
        sourceId: this.id,
      }));
    }

    try {
      const results = await this.deps.searchMarketplace(query.search);
      const tools: DiscoveredTool[] = results.map(r => ({
        id: r.slug,
        name: r.name,
        description: r.description || '',
        sourceId: this.id,
      }));
      return query.limit ? tools.slice(0, query.limit) : tools;
    } catch (err) {
      console.warn(`[RemoteSkillSource] searchMarketplace failed:`, (err as Error).message);
      return [];
    }
  }

  async getSkillsFor(_target: TargetPlatform): Promise<SkillDefinition[]> {
    // Remote source doesn't auto-generate skills.
    // Skills are installed explicitly by the user via search → install flow.
    // Return currently cached/downloaded skills as definitions.
    const downloaded = this.deps.listDownloadedSkills();
    const defs: SkillDefinition[] = [];

    for (const d of downloaded) {
      if (!d.wasInstalled) continue; // Only include previously installed skills

      defs.push({
        skillId: d.slug,
        name: d.name,
        description: d.description,
        version: d.version,
        sha: '', // Will be computed on actual install
        platform: _target,
        files: [], // Files loaded lazily via getSkillFiles
        trusted: false,
        sourceId: this.id,
        tags: d.tags,
        author: d.author,
      });
    }

    return defs;
  }

  async getBins(): Promise<RequiredBinary[]> {
    // Aggregate bins from downloaded skills' SKILL.md frontmatter
    const downloaded = this.deps.listDownloadedSkills();
    const binMap = new Map<string, RequiredBinary>();

    for (const d of downloaded) {
      if (!d.wasInstalled) continue;

      try {
        // We'd need the files to extract bins — but we can use a lightweight approach
        // by reading from the downloaded files cache. For now, return empty
        // and let the installer handle binary requirements from the full files.
      } catch {
        // Skip
      }
    }

    return Array.from(binMap.values());
  }

  async getSkillFiles(skillId: string): Promise<SkillDefinition | null> {
    try {
      // First try to download fresh from marketplace
      const detail = await this.deps.getMarketplaceSkill(skillId);
      if (!detail.files || detail.files.length === 0) {
        // Try ZIP download
        const zipFiles = await this.deps.downloadAndExtractZip(skillId);
        if (zipFiles.length === 0) return null;

        const files = toSkillFiles(zipFiles);
        return {
          skillId,
          name: detail.name,
          description: detail.description || '',
          version: detail.version || '0.0.0',
          sha: computeSkillDefinitionSha(files),
          platform: 'openclaw',
          files,
          trusted: false,
          sourceId: this.id,
          tags: detail.tags,
          author: detail.author,
        };
      }

      const files = toSkillFiles(detail.files);
      return {
        skillId,
        name: detail.name,
        description: detail.description || '',
        version: detail.version || '0.0.0',
        sha: computeSkillDefinitionSha(files),
        platform: 'openclaw',
        files,
        trusted: false,
        sourceId: this.id,
        tags: detail.tags,
        author: detail.author,
      };
    } catch (err) {
      console.warn(`[RemoteSkillSource] getSkillFiles failed for "${skillId}":`, (err as Error).message);
      return null;
    }
  }

  async getInstructions(): Promise<AdapterInstructions[]> {
    // No instructions from remote source
    return [];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
