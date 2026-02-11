/**
 * Catalog service — Search via pluggable adapters + local detail/list operations
 */

import type { Skill, SkillInstallation, SkillSearchResult, SkillVersion } from '@agenshield/ipc';
import type { SkillsRepository } from '@agenshield/storage';
import type { SearchAdapter } from './types';

export class CatalogService {
  constructor(
    private readonly skills: SkillsRepository,
    private readonly searchAdapters: SearchAdapter[],
  ) {}

  async search(query: string): Promise<SkillSearchResult[]> {
    const results: SkillSearchResult[] = [];
    const slugsSeen = new Set<string>();

    for (const adapter of this.searchAdapters) {
      const adapterResults = await adapter.search(query);
      for (const r of adapterResults) {
        if (!slugsSeen.has(r.skill.slug)) {
          slugsSeen.add(r.skill.slug);
          results.push(r);
        }
      }
    }

    return results;
  }

  getDetail(skillId: string): { skill: Skill; versions: SkillVersion[]; installations: SkillInstallation[] } | null {
    const skill = this.skills.getById(skillId);
    if (!skill) return null;

    const versions = this.skills.getVersions(skillId);
    const installations = this.skills.getInstallations();
    const versionIds = new Set(versions.map((v) => v.id));
    const relevantInstallations = installations.filter((i) => versionIds.has(i.skillVersionId));

    return { skill, versions, installations: relevantInstallations };
  }

  listInstalled(): Array<Skill & { version: SkillVersion }> {
    return this.skills.getInstalledSkills();
  }
}
