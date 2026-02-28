/**
 * Router Sync Service
 *
 * Synchronises the `allowHostPassthrough` flag in path-registry.json
 * based on the current set of managed policies with target='router'.
 */

import type { PolicyConfig } from '@agenshield/ipc';
import {
  readPathRegistry,
  writePathRegistry,
  type PathRegistry,
} from '@agenshield/sandbox';

/**
 * Determine whether the host passthrough should be allowed based on
 * managed policies. Returns `true` only when there is at least one
 * **enabled** managed policy with `target='router'`, `action='allow'`,
 * and `patterns` containing `'host-passthrough'`.
 */
export function shouldAllowHostPassthrough(policies: PolicyConfig[]): boolean {
  return policies.some(
    (p) =>
      p.target === 'router' &&
      p.action === 'allow' &&
      p.enabled &&
      p.patterns.includes('host-passthrough'),
  );
}

export interface RouterSyncResult {
  updated: boolean;
  registry: PathRegistry;
}

/**
 * Read path-registry.json, update `allowHostPassthrough` on every entry
 * according to the current policy set, and return the result.
 *
 * The caller is responsible for persisting the registry (direct write or
 * via privilege executor).
 */
export function syncRouterHostPassthrough(
  policies: PolicyConfig[],
  hostHome?: string,
  logger?: { info(msg: string): void },
): RouterSyncResult {
  const allow = shouldAllowHostPassthrough(policies);
  const registry = readPathRegistry(hostHome);
  let changed = false;

  for (const binName of Object.keys(registry)) {
    const entry = registry[binName];
    const current = entry.allowHostPassthrough ?? false;
    if (current !== allow) {
      entry.allowHostPassthrough = allow;
      changed = true;
    }
  }

  if (changed && logger) {
    logger.info(`[router-sync] Updated allowHostPassthrough to ${allow} for all registry entries`);
  }

  return { updated: changed, registry };
}

/**
 * Convenience: sync + write in one step (direct filesystem write).
 * Only use when running as a user who owns ~/.agenshield/.
 */
export function syncAndWriteRouterHostPassthrough(
  policies: PolicyConfig[],
  hostHome?: string,
  logger?: { info(msg: string): void },
): RouterSyncResult {
  const result = syncRouterHostPassthrough(policies, hostHome, logger);
  if (result.updated) {
    writePathRegistry(result.registry, hostHome);
  }
  return result;
}
