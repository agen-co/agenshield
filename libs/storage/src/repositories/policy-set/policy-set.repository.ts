/**
 * Policy Set repository — Hierarchical policy collections
 *
 * Manages named policy sets with parent-child relationships for
 * multi-tenancy policy inheritance.
 */

import { BaseRepository } from '../base.repository';
import type { DbPolicySetRow } from '../../types';
import { CreatePolicySetSchema, UpdatePolicySetSchema, UpdatePolicySetCodec } from './policy-set.schema';
import type { CreatePolicySetInput, UpdatePolicySetInput } from './policy-set.schema';
import { mapPolicySet } from './policy-set.model';
import type { PolicySet } from './policy-set.model';
import { Q } from './policy-set.query';

export class PolicySetRepository extends BaseRepository {
  /**
   * Create a policy set.
   */
  create(input: CreatePolicySetInput): PolicySet {
    const data = this.validate(CreatePolicySetSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insert).run({
      id,
      name: data.name,
      parentId: data.parentId ?? null,
      profileId: data.profileId ?? this.scope?.profileId ?? null,
      enforced: data.enforced ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      name: data.name,
      parentId: data.parentId,
      profileId: data.profileId ?? this.scope?.profileId ?? undefined,
      enforced: data.enforced ?? false,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a policy set by ID.
   */
  getById(id: string): PolicySet | null {
    const row = this.db.prepare(Q.selectById).get(id) as DbPolicySetRow | undefined;
    return row ? mapPolicySet(row) : null;
  }

  /**
   * Get all policy sets (optionally filtered by profile).
   */
  getAll(): PolicySet[] {
    const rows = this.db.prepare(Q.selectAll).all() as DbPolicySetRow[];
    return rows.map(mapPolicySet);
  }

  /**
   * Get policy sets for a specific profile.
   */
  getByProfileId(profileId: string): PolicySet[] {
    const rows = this.db.prepare(Q.selectByProfileId).all(profileId) as DbPolicySetRow[];
    return rows.map(mapPolicySet);
  }

  /**
   * Get child policy sets.
   */
  getChildren(parentId: string): PolicySet[] {
    const rows = this.db.prepare(Q.selectChildren).all(parentId) as DbPolicySetRow[];
    return rows.map(mapPolicySet);
  }

  /**
   * Update a policy set.
   */
  update(id: string, input: UpdatePolicySetInput): PolicySet | null {
    const data = this.validate(UpdatePolicySetSchema, input);
    if (!this.getById(id)) return null;

    const encoded = UpdatePolicySetCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'policy_sets', 'id = @id', { id });
    return this.getById(id);
  }

  /**
   * Delete a policy set and its member associations.
   */
  delete(id: string): boolean {
    const result = this.db.prepare(Q.deleteById).run(id);
    return result.changes > 0;
  }

  // ---- Members ----

  /**
   * Add a policy to a policy set.
   */
  addMember(policySetId: string, policyId: string): void {
    this.db.prepare(Q.addMember).run({ policySetId, policyId });
  }

  /**
   * Remove a policy from a policy set.
   */
  removeMember(policySetId: string, policyId: string): void {
    this.db.prepare(Q.removeMember).run({ policySetId, policyId });
  }

  /**
   * Get policy IDs that belong to a policy set.
   */
  getMemberPolicyIds(policySetId: string): string[] {
    const rows = this.db.prepare(Q.selectMembers).all(policySetId) as Array<{ policy_id: string }>;
    return rows.map(r => r.policy_id);
  }

  /**
   * Get policy set IDs that a policy belongs to.
   */
  getMemberships(policyId: string): string[] {
    const rows = this.db.prepare(Q.selectMemberships).all(policyId) as Array<{ policy_set_id: string }>;
    return rows.map(r => r.policy_set_id);
  }

  /**
   * Walk the parent chain from a policy set up to root, returning sets in order.
   * Used by hierarchy resolver.
   */
  getParentChain(policySetId: string): PolicySet[] {
    const chain: PolicySet[] = [];
    const visited = new Set<string>();
    let current = this.getById(policySetId);

    while (current && !visited.has(current.id)) {
      chain.push(current);
      visited.add(current.id);
      current = current.parentId ? this.getById(current.parentId) : null;
    }

    return chain;
  }
}
