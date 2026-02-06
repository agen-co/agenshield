/**
 * Skill Loader
 *
 * Loads and parses SKILL.md files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Skill, SkillManifest } from './types.js';

export class SkillLoader {
  /**
   * Load a skill from a file path
   */
  async loadFromFile(filePath: string): Promise<Skill> {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseSkill(content, filePath);
  }

  /**
   * Load skills from a directory
   */
  async loadFromDirectory(dirPath: string): Promise<Skill[]> {
    const skills: Skill[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Look for SKILL.md in subdirectory
          const skillPath = path.join(dirPath, entry.name, 'SKILL.md');
          try {
            const skill = await this.loadFromFile(skillPath);
            skills.push(skill);
          } catch {
            // Skip directories without valid SKILL.md
          }
        } else if (entry.name === 'SKILL.md') {
          // SKILL.md directly in directory
          const skill = await this.loadFromFile(path.join(dirPath, entry.name));
          skills.push(skill);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return skills;
  }

  /**
   * Load skills from multiple directories
   */
  async loadFromDirectories(dirs: string[]): Promise<Skill[]> {
    const skills: Skill[] = [];

    for (const dir of dirs) {
      const dirSkills = await this.loadFromDirectory(dir);
      skills.push(...dirSkills);
    }

    return skills;
  }

  /**
   * Parse a SKILL.md file content
   */
  private parseSkill(content: string, sourcePath: string): Skill {
    const { frontmatter, body } = this.parseFrontmatter(content);
    const manifest = this.parseManifest(frontmatter);

    return {
      name: manifest.name,
      description: manifest.description,
      userInvocable: manifest.userInvocable ?? true,
      disableModelInvocation: manifest.disableModelInvocation ?? false,
      commandDispatch: manifest.commandDispatch ?? 'bash',
      commandTool: manifest.commandTool ?? 'Bash',
      commandArgMode: manifest.commandArgMode ?? 'single',
      requires: manifest.requires ?? {},
      agenshield: manifest.agenshield ?? {},
      content: body.trim(),
      sourcePath,
    };
  }

  /**
   * Parse YAML frontmatter from content
   */
  private parseFrontmatter(content: string): { frontmatter: string; body: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

    if (!match) {
      throw new Error('Invalid SKILL.md: Missing YAML frontmatter');
    }

    return {
      frontmatter: match[1],
      body: match[2],
    };
  }

  /**
   * Parse YAML frontmatter into manifest
   */
  private parseManifest(yaml: string): SkillManifest {
    // Simple YAML parser for skill manifests
    const lines = yaml.split('\n');
    const result: Record<string, any> = {};
    const stack: Array<{ obj: any; indent: number }> = [{ obj: result, indent: -1 }];

    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const indent = line.search(/\S/);
      const content = line.trim();

      // Handle list items
      if (content.startsWith('- ')) {
        const value = content.slice(2).trim();
        const parent = stack[stack.length - 1].obj;
        const lastKey = Object.keys(parent).pop();

        if (lastKey && Array.isArray(parent[lastKey])) {
          parent[lastKey].push(this.parseValue(value));
        }
        continue;
      }

      // Handle key-value pairs
      const colonIndex = content.indexOf(':');
      if (colonIndex === -1) continue;

      const key = content.slice(0, colonIndex).trim();
      const value = content.slice(colonIndex + 1).trim();

      // Pop stack to correct level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const current = stack[stack.length - 1].obj;

      if (value === '') {
        // Nested object or array
        const nextLine = lines[lines.indexOf(line) + 1] || '';
        if (nextLine.trim().startsWith('- ')) {
          current[key] = [];
        } else {
          current[key] = {};
        }
        stack.push({ obj: current[key], indent });
      } else {
        current[key] = this.parseValue(value);
      }
    }

    // Convert to SkillManifest format
    return this.normalizeManifest(result);
  }

  /**
   * Parse a YAML value
   */
  private parseValue(value: string): any {
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Number
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (/^-?\d*\.\d+$/.test(value)) return parseFloat(value);

    // String (remove quotes if present)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    return value;
  }

  /**
   * Normalize parsed YAML to SkillManifest
   */
  private normalizeManifest(raw: Record<string, any>): SkillManifest {
    return {
      name: raw.name || raw.Name,
      description: raw.description || raw.Description || '',
      userInvocable: raw['user-invocable'] ?? raw.userInvocable,
      disableModelInvocation: raw['disable-model-invocation'] ?? raw.disableModelInvocation,
      commandDispatch: raw['command-dispatch'] ?? raw.commandDispatch,
      commandTool: raw['command-tool'] ?? raw.commandTool,
      commandArgMode: raw['command-arg-mode'] ?? raw.commandArgMode,
      requires: raw.requires,
      agenshield: raw.agenshield,
      always: raw.always,
      os: raw.os,
      primaryEnv: raw['primary-env'] ?? raw.primaryEnv,
      install: raw.install,
      homepage: raw.homepage,
      emoji: raw.emoji,
      metadata: raw.metadata,
    };
  }
}
