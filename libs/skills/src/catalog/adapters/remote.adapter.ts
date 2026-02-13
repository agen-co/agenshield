/**
 * RemoteSearchAdapter — Wraps RemoteSkillClient.search() for marketplace search
 */

import type { SkillSearchResult } from '@agenshield/ipc';
import type { RemoteSkillClient } from '../../remote/types';
import type { SearchAdapter } from '../types';

export class RemoteSearchAdapter implements SearchAdapter {
  readonly id = 'remote';
  readonly displayName = 'Marketplace';

  constructor(private readonly client: RemoteSkillClient) {}

  async search(query: string): Promise<SkillSearchResult[]> {
    try {
      const response = await this.client.search(query);
      return response.results.map((r) => ({
        skill: {
          id: '',
          name: r.name,
          slug: r.slug,
          author: r.author,
          description: r.description,
          tags: r.tags,
          source: 'marketplace' as const,
          remoteId: r.remoteId,
          isPublic: true,
          createdAt: '',
          updatedAt: '',
        },
        source: 'remote' as const,
      }));
    } catch {
      return [];
    }
  }
}
