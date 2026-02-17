/**
 * Re-export URL/pattern matching utilities from @agenshield/policies.
 *
 * This file is kept for backward compatibility — existing daemon code
 * and the per-run proxy import from here.
 */

export {
  globToRegex,
  normalizeUrlBase,
  normalizeUrlTarget,
  matchUrlPattern,
  checkUrlPolicy,
  policyScopeMatches,
  extractCommandBasename,
  commandScopeMatches,
  filterUrlPoliciesForCommand,
} from '@agenshield/policies';

/** @deprecated Use `commandScopeMatches` instead */
export const urlPolicyScopeMatchesCommand = commandScopeMatches;

import { commandScopeMatches } from '@agenshield/policies';
