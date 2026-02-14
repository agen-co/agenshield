/**
 * Profile model -- Row mappers (DB row -> domain type)
 */

import type { Profile } from '@agenshield/ipc';
import type { DbProfileRow } from '../../types';

export function mapProfile(row: DbProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Profile['type'],
    targetName: row.target_name ?? undefined,
    presetId: row.preset_id ?? undefined,
    description: row.description ?? undefined,
    agentUsername: row.agent_username ?? undefined,
    agentUid: row.agent_uid ?? undefined,
    agentHomeDir: row.agent_home_dir ?? undefined,
    brokerUsername: row.broker_username ?? undefined,
    brokerUid: row.broker_uid ?? undefined,
    brokerHomeDir: row.broker_home_dir ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
