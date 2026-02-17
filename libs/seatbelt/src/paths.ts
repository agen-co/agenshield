/**
 * Re-export sandbox path functions from @agenshield/policies.
 *
 * These live in the policies library (which has no circular dependency)
 * and are re-exported here for convenience so seatbelt consumers don't
 * need a separate policies import for path-only operations.
 */

export {
  extractConcreteDenyPaths,
  collectDenyPathsFromPolicies,
  collectAllowPathsForCommand,
} from '@agenshield/policies';
