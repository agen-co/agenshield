/**
 * Policy repository — Scoped CRUD with preset seeding
 *
 * Policies: UNION all matching scopes (additive, priority for conflicts).
 */

import type { PolicyConfig } from '@agenshield/ipc';
import { PolicyConfigSchema, POLICY_PRESETS } from '@agenshield/ipc';
import type { DbPolicyRow } from '../../types';
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
      createdAt: now,
      updatedAt: now,
    });

    return policy;
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
   * Seed preset policies for a profile (if not already present).
   */
  seedPreset(presetId: string): number {
    const preset = POLICY_PRESETS.find((p) => p.id === presetId);
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
