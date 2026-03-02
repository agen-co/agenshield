/**
 * Policy repository — Scoped CRUD with preset seeding
 *
 * Policies: UNION all matching scopes (additive, priority for conflicts).
 * Tier hierarchy: managed > target > global.
 */

import type { PolicyConfig, TieredPolicies } from '@agenshield/ipc';
import { PolicyConfigSchema, getPresetById } from '@agenshield/ipc';
import type { DbPolicyRow, DbProfileRow } from '../../types';
import { buildScopeWhere, buildPolicyScopeWhere } from '../../scoping';
import { BaseRepository } from '../base.repository';
import type { CreatePolicyInput } from './policy.schema';
import { UpdatePolicySchema, UpdatePolicyCodec } from './policy.schema';
import type { UpdatePolicyInput } from './policy.schema';
import { mapPolicy } from './policy.model';
import { Q } from './policy.query';

export class PolicyRepository extends BaseRepository {
  /**
   * Create a policy.
   */
  create(input: CreatePolicyInput): PolicyConfig {
    const policy = this.validate(PolicyConfigSchema, input);
    const now = this.now();

    this.db.prepare(Q.insert).run({
      id: policy.id,
      profileId: this.scope?.profileId ?? null,
      name: policy.name,
      action: policy.action,
      target: policy.target,
      patterns: JSON.stringify(policy.patterns),
      enabled: policy.enabled ? 1 : 0,
      priority: policy.priority ?? null,
      operations: policy.operations ? JSON.stringify(policy.operations) : null,
      preset: policy.preset ?? null,
      scope: policy.scope ?? null,
      networkAccess: policy.networkAccess ?? null,
      enforcement: policy.enforcement ?? null,
      methods: policy.methods ? JSON.stringify(policy.methods) : null,
      managed: 0,
      managedSource: null,
      createdAt: now,
      updatedAt: now,
    });

    return { ...policy, tier: this.scope?.profileId ? 'target' : 'global' };
  }

  /**
   * Create a managed (admin-enforced) policy. Always global scope.
   */
  createManaged(input: CreatePolicyInput, source?: string): PolicyConfig {
    const policy = this.validate(PolicyConfigSchema, input);
    const now = this.now();

    this.db.prepare(Q.insert).run({
      id: policy.id,
      profileId: null, // Managed policies are always global
      name: policy.name,
      action: policy.action,
      target: policy.target,
      patterns: JSON.stringify(policy.patterns),
      enabled: policy.enabled ? 1 : 0,
      priority: policy.priority ?? null,
      operations: policy.operations ? JSON.stringify(policy.operations) : null,
      preset: policy.preset ?? null,
      scope: policy.scope ?? null,
      networkAccess: policy.networkAccess ?? null,
      enforcement: policy.enforcement ?? null,
      methods: policy.methods ? JSON.stringify(policy.methods) : null,
      managed: 1,
      managedSource: source ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return { ...policy, tier: 'managed' };
  }

  /**
   * Get a policy by ID.
   */
  getById(id: string): PolicyConfig | null {
    const row = this.db.prepare(Q.selectById).get(id) as DbPolicyRow | undefined;
    return row ? mapPolicy(row) : null;
  }

  /**
   * Get all policies for a scope (UNION of global + profile).
   */
  getAll(): PolicyConfig[] {
    const { clause, params } = buildPolicyScopeWhere(this.scope);
    const rows = this.db.prepare(Q.selectAllScoped(clause)).all(params) as DbPolicyRow[];
    return rows.map(mapPolicy);
  }

  /**
   * Get all enabled policies for a scope.
   */
  getEnabled(): PolicyConfig[] {
    const { clause, params } = buildPolicyScopeWhere(this.scope);
    const rows = this.db.prepare(Q.selectEnabledScoped(clause)).all(params) as DbPolicyRow[];
    return rows.map(mapPolicy);
  }

  /**
   * Get all managed policies (always global scope).
   */
  getManaged(): PolicyConfig[] {
    const rows = this.db.prepare(Q.selectManaged).all() as DbPolicyRow[];
    return rows.map(mapPolicy);
  }

  /**
   * Get policies organized by tier.
   * In scoped context: returns managed, global, and target-specific policies.
   * In global context: returns managed and global policies (no target).
   */
  getTiered(): TieredPolicies {
    const managed = this.getManaged();

    if (this.scope?.profileId) {
      // Scoped context: separate global vs target-specific non-managed policies
      const nonManagedGlobal = this.db.prepare(Q.selectNonManaged('profile_id IS NULL'))
        .all() as DbPolicyRow[];
      const nonManagedTarget = this.db.prepare(Q.selectNonManaged('profile_id = @profileId'))
        .all({ profileId: this.scope.profileId }) as DbPolicyRow[];

      return {
        managed,
        global: nonManagedGlobal.map(mapPolicy),
        target: nonManagedTarget.map(mapPolicy),
      };
    }

    // Global context: just managed + global non-managed
    const nonManagedGlobal = this.db.prepare(Q.selectNonManaged('profile_id IS NULL'))
      .all() as DbPolicyRow[];

    return {
      managed,
      global: nonManagedGlobal.map(mapPolicy),
      target: [],
    };
  }

  /**
   * Get all target sections with their policies (for global view).
   */
  getAllTargetSections(): TieredPolicies['targetSections'] {
    const profiles = this.db.prepare(
      'SELECT id, target_name, name FROM profiles ORDER BY name',
    ).all() as Array<Pick<DbProfileRow, 'id' | 'target_name' | 'name'>>;

    const sections: NonNullable<TieredPolicies['targetSections']> = [];

    for (const profile of profiles) {
      const rows = this.db.prepare(Q.selectNonManaged('profile_id = @profileId'))
        .all({ profileId: profile.id }) as DbPolicyRow[];

      if (rows.length > 0) {
        sections.push({
          profileId: profile.id,
          targetName: profile.target_name ?? profile.name,
          policies: rows.map(mapPolicy),
        });
      }
    }

    return sections;
  }

  /**
   * Update a policy.
   */
  update(id: string, input: UpdatePolicyInput): PolicyConfig | null {
    const data = this.validate(UpdatePolicySchema, input);
    if (!this.getById(id)) return null;

    const encoded = UpdatePolicyCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'policies', 'id = @id', { id });
    return this.getById(id);
  }

  /**
   * Delete a policy.
   */
  delete(id: string): boolean {
    const result = this.db.prepare(Q.deleteById).run(id);
    return result.changes > 0;
  }

  /**
   * Delete all policies for a scope.
   */
  deleteAll(): number {
    const { clause, params } = buildScopeWhere(this.scope ?? { profileId: null });
    const result = this.db.prepare(Q.deleteScoped(clause)).run(params);
    return result.changes;
  }

  /**
   * Delete only non-managed policies for a scope.
   * Used by saveConfig to preserve managed policies during the delete+re-insert cycle.
   */
  deleteNonManaged(): number {
    const { clause, params } = buildScopeWhere(this.scope ?? { profileId: null });
    const result = this.db.prepare(Q.deleteNonManagedScoped(clause)).run(params);
    return result.changes;
  }

  /**
   * Delete all managed policies from a specific source.
   * Used by the batch sync endpoint to replace all policies from an external source.
   */
  deleteManagedBySource(source: string): number {
    const result = this.db.prepare(Q.deleteManagedBySource).run({ source });
    return result.changes;
  }

  /**
   * Seed preset policies for a profile (if not already present).
   */
  seedPreset(presetId: string): number {
    const preset = getPresetById(presetId);
    if (!preset) return 0;

    let count = 0;
    for (const policy of preset.policies) {
      const existing = this.getById(policy.id);
      if (!existing) {
        this.create(policy);
        count++;
      }
    }
    return count;
  }

  /**
   * Count policies by scope.
   */
  count(): number {
    const { clause, params } = buildPolicyScopeWhere(this.scope);
    const row = this.db.prepare(Q.countScoped(clause)).get(params) as { count: number };
    return row.count;
  }
}
