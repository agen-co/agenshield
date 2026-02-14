/**
 * Config repository — Scoped CRUD with cascading merge
 *
 * Config resolution: base (global) -> profile
 * NULL values in a more specific scope inherit from parent scope.
 */

import type { DbConfigRow } from '../../types';
import { buildScopeWhere, getConfigScopeLevels, mergeConfigRows } from '../../scoping';
import { BaseRepository } from '../base.repository';
import { type ConfigData, UpdateConfigSchema } from './config.schema';
import { mapConfig } from './config.model';
import { Q } from './config.query';

export class ConfigRepository extends BaseRepository {
  /**
   * Get resolved config for a scope (merges base + profile).
   */
  get(): ConfigData | null {
    const levels = getConfigScopeLevels(this.scope);
    const rows: DbConfigRow[] = [];

    for (const level of levels) {
      const { clause, params } = buildScopeWhere(level);
      const row = this.db
        .prepare(Q.selectWhere(clause))
        .get(params) as DbConfigRow | undefined;
      if (row) rows.push(row);
    }

    const merged = mergeConfigRows(rows);
    return merged ? mapConfig(merged) : null;
  }

  /**
   * Get raw (unmerged) config for an exact scope level.
   */
  getRaw(): ConfigData | null {
    const { clause, params } = buildScopeWhere(
      this.scope ?? { profileId: null },
    );
    const row = this.db
      .prepare(Q.selectWhere(clause))
      .get(params) as DbConfigRow | undefined;
    return row ? mapConfig(row) : null;
  }

  /**
   * Set config for a scope level (upsert).
   */
  set(data: ConfigData): void {
    const validated = this.validate(UpdateConfigSchema, data);
    const profileId = this.scope?.profileId ?? null;
    const now = this.now();

    this.db.prepare(Q.upsert).run({
      profileId,
      version: validated.version ?? null,
      daemonPort: validated.daemonPort ?? null,
      daemonHost: validated.daemonHost ?? null,
      daemonLogLevel: validated.daemonLogLevel ?? null,
      daemonEnableHostsEntry:
        validated.daemonEnableHostsEntry != null
          ? (validated.daemonEnableHostsEntry ? 1 : 0)
          : null,
      defaultAction: validated.defaultAction ?? null,
      vaultEnabled:
        validated.vaultEnabled != null
          ? (validated.vaultEnabled ? 1 : 0)
          : null,
      vaultProvider: validated.vaultProvider ?? null,
      skillsJson: validated.skillsJson ?? null,
      soulJson: validated.soulJson ?? null,
      brokerJson: validated.brokerJson ?? null,
      updatedAt: now,
    });
  }

  /**
   * Delete config for an exact scope level.
   */
  delete(): boolean {
    const { clause, params } = buildScopeWhere(
      this.scope ?? { profileId: null },
    );
    const result = this.db.prepare(Q.deleteWhere(clause)).run(params);
    return result.changes > 0;
  }
}
