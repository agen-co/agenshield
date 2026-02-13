/**
 * Static Skill Source
 *
 * Loads skills from disk directories, individual files, or inline definitions.
 * No network dependencies — pure file I/O and in-memory storage.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SkillSourceAdapter,
  SkillDefinition,
  SourceSkillFile,
  DiscoveredTool,
  RequiredBinary,
  AdapterInstructions,
  TargetPlatform,
  ToolQuery,
} from '@agenshield/ipc';
import { computeSkillDefinitionSha } from './utils';

/**
 * Read all files recursively from a directory, returning relative paths.
 */
function readDirFiles(dirPath: string, basePath = ''): SourceSkillFile[] {
  const files: SourceSkillFile[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const relativeName = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...readDirFiles(path.join(dirPath, entry.name), relativeName));
      } else {
        try {
          const content = fs.readFileSync(path.join(dirPath, entry.name), 'utf-8');
          files.push({ name: relativeName, content });
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Directory may not exist
  }
  return files;
}

/**
 * Extract basic metadata from SKILL.md YAML frontmatter.
 * Minimal parser — extracts name, description, and requires.bins.
 */
function extractFrontmatter(content: string): {
  name?: string;
  description?: string;
  bins?: string[];
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*(.+)$/m);

  // Extract requires.bins (simple indent-based parsing)
  const bins: string[] = [];
  const binsSection = yaml.match(/requires:\s*\n\s+bins:\s*\n((?:\s+-\s+.+\n?)*)/);
  if (binsSection) {
    const binLines = binsSection[1].matchAll(/^\s+-\s+(.+)$/gm);
    for (const m of binLines) {
      bins.push(m[1].trim());
    }
  }

  return {
    name: nameMatch?.[1]?.trim(),
    description: descMatch?.[1]?.replace(/^["']|["']$/g, '').trim(),
    bins: bins.length > 0 ? bins : undefined,
  };
}

export class StaticSkillSource implements SkillSourceAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly trusted = true;

  private skills = new Map<string, SkillDefinition>();

  constructor(id = 'static', displayName = 'Built-in Skills') {
    this.id = id;
    this.displayName = displayName;
  }

  /** Add a skill from a directory on disk (reads all files recursively) */
  addFromDirectory(skillId: string, dirPath: string, platform: TargetPlatform = 'openclaw'): void {
    const files = readDirFiles(dirPath);
    if (files.length === 0) return;

    const skillMd = files.find(f => f.name === 'SKILL.md');
    const meta = skillMd ? extractFrontmatter(skillMd.content) : {};

    const definition: SkillDefinition = {
      skillId,
      name: meta.name ?? skillId,
      description: meta.description ?? '',
      version: '1.0.0',
      sha: computeSkillDefinitionSha(files),
      platform,
      files,
      trusted: true,
      sourceId: this.id,
      author: 'agenshield',
    };

    this.skills.set(skillId, definition);
  }

  /** Add a skill from a single SKILL.md file */
  addFromFile(skillId: string, filePath: string, platform: TargetPlatform = 'openclaw'): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const meta = extractFrontmatter(content);
      const files: SourceSkillFile[] = [{ name: 'SKILL.md', content }];

      const definition: SkillDefinition = {
        skillId,
        name: meta.name ?? skillId,
        description: meta.description ?? '',
        version: '1.0.0',
        sha: computeSkillDefinitionSha(files),
        platform,
        files,
        trusted: true,
        sourceId: this.id,
        author: 'agenshield',
      };

      this.skills.set(skillId, definition);
    } catch {
      // File unreadable — skip
    }
  }

  /** Add a skill programmatically (no file I/O) */
  addInline(definition: SkillDefinition): void {
    this.skills.set(definition.skillId, { ...definition, sourceId: this.id });
  }

  /** Remove a previously added skill */
  remove(skillId: string): void {
    this.skills.delete(skillId);
  }

  /** Bulk load all subdirectories from a base directory as individual skills */
  loadDirectory(baseDir: string, platform: TargetPlatform = 'openclaw'): void {
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          this.addFromDirectory(entry.name, path.join(baseDir, entry.name), platform);
        }
      }
    } catch {
      // Base directory may not exist
    }
  }

  // ─── SkillSourceAdapter implementation ────────────────────────

  async getTools(query?: ToolQuery): Promise<DiscoveredTool[]> {
    const tools: DiscoveredTool[] = [];
    for (const [, def] of this.skills) {
      const tool: DiscoveredTool = {
        id: def.skillId,
        name: def.name,
        description: def.description,
        sourceId: this.id,
      };
      if (query?.search) {
        const q = query.search.toLowerCase();
        if (!tool.name.toLowerCase().includes(q) && !tool.description.toLowerCase().includes(q)) {
          continue;
        }
      }
      tools.push(tool);
    }
    return query?.limit ? tools.slice(0, query.limit) : tools;
  }

  async getSkillsFor(_target: TargetPlatform): Promise<SkillDefinition[]> {
    return Array.from(this.skills.values());
  }

  async getBins(): Promise<RequiredBinary[]> {
    const binSet = new Map<string, RequiredBinary>();
    for (const [, def] of this.skills) {
      const skillMd = def.files.find(f => f.name === 'SKILL.md');
      if (!skillMd) continue;
      const meta = extractFrontmatter(skillMd.content);
      if (meta.bins) {
        for (const bin of meta.bins) {
          if (!binSet.has(bin)) {
            binSet.set(bin, {
              name: bin,
              installMethods: [],
              managedByShield: true,
            });
          }
        }
      }
    }
    return Array.from(binSet.values());
  }

  async getSkillFiles(skillId: string): Promise<SkillDefinition | null> {
    return this.skills.get(skillId) ?? null;
  }

  async getInstructions(): Promise<AdapterInstructions[]> {
    return [];
  }

  async isAvailable(): Promise<boolean> {
    return this.skills.size > 0;
  }
}
