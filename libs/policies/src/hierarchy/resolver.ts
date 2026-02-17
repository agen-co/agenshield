/**
 * Hierarchy Resolver
 *
 * Walks the parent chain of policy sets and merges policies:
 * 1. Start with the target's own policy set
 * 2. Walk up parent chain, collecting policies
 * 3. Enforced policies from parent cannot be overridden
 * 4. Non-enforced policies can be overridden by child (same target+pattern = child wins)
 * 5. Return merged effective policies sorted by priority DESC
 */

import type { PolicyConfig } from '@agenshield/ipc';
import type { PolicySetRepository, PolicyRepository, PolicySet } from '@agenshield/storage';
import type { HierarchyNode, ResolvedHierarchy } from './types';

export class HierarchyResolver {
  constructor(
    private readonly policySets: PolicySetRepository,
    private readonly policies: PolicyRepository,
  ) {}

  /**
   * Resolve effective policies for a given policy set by walking the parent chain.
   *
   * Algorithm:
   * - Walk from leaf (provided set) up to root via parentId chain
   * - Collect policies at each level
   * - Enforced parent policies cannot be overridden by children
   * - Non-enforced parent policies can be overridden (child policy with same id wins)
   * - Final list sorted by priority DESC
   */
  resolveEffectivePolicies(policySetId: string): ResolvedHierarchy {
    const chain = this.policySets.getParentChain(policySetId);
    if (chain.length === 0) {
      return { policies: [], chain: [] };
    }

    // Build hierarchy nodes (leaf → root order)
    const hierarchyNodes: HierarchyNode[] = chain.map(set => ({
      policySetId: set.id,
      name: set.name,
      enforced: set.enforced,
      policies: this.loadPoliciesForSet(set),
    }));

    // Merge: reverse to root → leaf order
    // Root policies go in first, then each child level can override non-enforced ones
    const reversed = [...hierarchyNodes].reverse();

    // Track enforced policy IDs — these cannot be overridden
    const enforcedIds = new Set<string>();
    const effectiveMap = new Map<string, PolicyConfig>();

    for (const node of reversed) {
      for (const policy of node.policies) {
        if (enforcedIds.has(policy.id)) {
          // This policy is enforced by a parent — child cannot override
          continue;
        }

        effectiveMap.set(policy.id, policy);

        if (node.enforced) {
          enforcedIds.add(policy.id);
        }
      }
    }

    const policies = [...effectiveMap.values()]
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    return { policies, chain: hierarchyNodes };
  }

  /**
   * Load policies that belong to a policy set via the junction table.
   */
  private loadPoliciesForSet(set: PolicySet): PolicyConfig[] {
    const memberIds = this.policySets.getMemberPolicyIds(set.id);
    const policies: PolicyConfig[] = [];
    for (const id of memberIds) {
      const policy = this.policies.getById(id);
      if (policy) {
        policies.push(policy);
      }
    }
    return policies;
  }
}
