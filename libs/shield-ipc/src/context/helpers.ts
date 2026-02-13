/**
 * Shield context helpers
 */

import type { ScopeFilter } from '../storage/storage.types';
import type { ShieldContext } from './shield-context';

/**
 * Convert a ShieldContext to a ScopeFilter for storage queries.
 */
export function contextToScope(ctx: ShieldContext): ScopeFilter {
  return { targetId: ctx.targetId, userUsername: ctx.userUsername };
}
