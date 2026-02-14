/**
 * Storage domain types
 *
 * Shared types for the storage layer (scope filtering, metadata).
 */

export interface ScopeFilter {
  profileId?: string | null;
}

export interface MetaEntry {
  key: string;
  value: string;
}
