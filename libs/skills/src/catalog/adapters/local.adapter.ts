/**
 * LocalSearchAdapter — Wraps SkillsRepository.search() for local DB search
 */

import type { SkillSearchResult } from '@agenshield/ipc';
import type { SkillsRepository } from '@agenshield/storage';
import type { SearchAdapter } from '../types';

export class LocalSearchAdapter implements SearchAdapter {
  readonly id = 'local';
  readonly displayName = 'Local Database';

  constructor(private readonly skills: SkillsRepository) {}

  async search(query: string): Promise<SkillSearchResult[]> {
    const skills = this.skills.search(query);
    return skills.map((skill) => {
      const latestVersion = this.skills.getLatestVersion(skill.id) ?? undefined;
      return { skill, latestVersion, source: 'local' as const };
    });
  }
}
