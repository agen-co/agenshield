/**
 * Policy set row mapper
 */

import type { DbPolicySetRow } from '../../types';

export interface PolicySet {
  id: string;
  name: string;
  parentId?: string;
  profileId?: string;
  enforced: boolean;
  createdAt: string;
  updatedAt: string;
}

export function mapPolicySet(row: DbPolicySetRow): PolicySet {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? undefined,
    profileId: row.profile_id ?? undefined,
    enforced: row.enforced === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
