/**
 * Target model — Row mappers (DB row → domain type)
 */

import type { Target, TargetUser } from '@agenshield/ipc';
import type { DbTargetRow, DbTargetUserRow } from '../../types';

// ---- Row mappers ----

export function mapTarget(row: DbTargetRow): Target {
  return {
    id: row.id,
    name: row.name,
    presetId: row.preset_id ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTargetUser(row: DbTargetUserRow): TargetUser {
  return {
    targetId: row.target_id,
    userUsername: row.user_username,
    role: row.role as 'agent' | 'broker',
    createdAt: row.created_at,
  };
}
