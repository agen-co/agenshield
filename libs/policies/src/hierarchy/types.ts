/**
 * Hierarchy types for multi-tenancy policy resolution.
 */

import type { PolicyConfig } from '@agenshield/ipc';

/** A node in the hierarchy chain: policy set + its resolved policies */
export interface HierarchyNode {
  policySetId: string;
  name: string;
  enforced: boolean;
  policies: PolicyConfig[];
}

/** Result of hierarchy resolution */
export interface ResolvedHierarchy {
  /** Effective policies after parent-chain merge, sorted by priority DESC */
  policies: PolicyConfig[];
  /** Chain of policy sets from leaf to root */
  chain: HierarchyNode[];
}
