/**
 * Graph secret resolution.
 *
 * Resolves secret values by name from a secrets repository,
 * used during graph effect evaluation for inject_secret edges.
 */

import type { SecretsResolver } from '../graph/effects';

/**
 * Create a SecretsResolver from a storage secrets repository.
 * Wraps vault access with error handling (returns null on locked vault).
 */
export function createSecretsResolver(
  secretsRepo: { getByName(name: string): { value: string } | null },
): SecretsResolver {
  return {
    getByName(name: string) {
      try {
        return secretsRepo.getByName(name);
      } catch {
        // StorageLockedError or other vault access issues
        return null;
      }
    },
  };
}
