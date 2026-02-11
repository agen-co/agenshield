/**
 * Catalog search adapter interfaces
 */

import type { SkillSearchResult } from '@agenshield/ipc';

/** Adapter for pluggable skill search sources. Multiple adapters run together. */
export interface SearchAdapter {
  /** Unique adapter identifier */
  readonly id: string;
  /** Human-readable name */
  readonly displayName: string;
  /** Search for skills matching the query. */
  search(query: string): Promise<SkillSearchResult[]>;
}
