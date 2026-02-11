/**
 * Policy model — DB row mapper
 */

import type { PolicyConfig } from '@agenshield/ipc';
import type { DbPolicyRow } from '../../types';

// ---- Row mapper ----

export function mapPolicy(row: DbPolicyRow): PolicyConfig {
  return {
    id: row.id,
    name: row.name,
    action: row.action as PolicyConfig['action'],
    target: row.target as PolicyConfig['target'],
    patterns: JSON.parse(row.patterns),
    enabled: row.enabled === 1,
    priority: row.priority ?? undefined,
    operations: row.operations ? JSON.parse(row.operations) : undefined,
    preset: row.preset ?? undefined,
    scope: row.scope ?? undefined,
    networkAccess: row.network_access as PolicyConfig['networkAccess'],
  };
}
