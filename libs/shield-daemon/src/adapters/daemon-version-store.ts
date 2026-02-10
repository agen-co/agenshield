/**
 * Daemon Version Store
 *
 * JSON-file-backed implementation of SkillVersionStore.
 * Tracks installed skill versions with SHA hashes for update detection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillVersionStore, InstalledSkillVersion } from '@agenshield/skills';
import { CONFIG_DIR } from '@agenshield/ipc';

const VERSION_FILE = 'skill-versions.json';

export class DaemonVersionStore implements SkillVersionStore {
  private versions = new Map<string, InstalledSkillVersion>();
  private filePath: string;

  constructor(configDir?: string) {
    this.filePath = path.join(configDir ?? CONFIG_DIR, VERSION_FILE);
    this.load();
  }

  getInstalled(skillId: string): InstalledSkillVersion | null {
    return this.versions.get(skillId) ?? null;
  }

  setInstalled(info: InstalledSkillVersion): void {
    this.versions.set(info.skillId, info);
    this.save();
  }

  removeInstalled(skillId: string): void {
    if (this.versions.delete(skillId)) {
      this.save();
    }
  }

  listInstalled(): InstalledSkillVersion[] {
    return Array.from(this.versions.values());
  }

  listBySource(sourceId: string): InstalledSkillVersion[] {
    return Array.from(this.versions.values()).filter(v => v.sourceId === sourceId);
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const entry of data) {
            if (entry.skillId) {
              this.versions.set(entry.skillId, entry as InstalledSkillVersion);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[DaemonVersionStore] Failed to load ${this.filePath}: ${(err as Error).message}`);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.versions.values());
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[DaemonVersionStore] Failed to save ${this.filePath}: ${(err as Error).message}`);
    }
  }
}
