/**
 * Workspace skills model — DB row mapper
 */

import type { WorkspaceSkill } from '@agenshield/ipc';
import type { DbWorkspaceSkillRow } from '../../types';

export function mapWorkspaceSkill(row: DbWorkspaceSkillRow): WorkspaceSkill {
  return {
    id: row.id,
    profileId: row.profile_id,
    workspacePath: row.workspace_path,
    skillName: row.skill_name,
    status: row.status as WorkspaceSkill['status'],
    contentHash: row.content_hash ?? undefined,
    backupHash: row.backup_hash ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    cloudSkillId: row.cloud_skill_id ?? undefined,
    removedAt: row.removed_at ?? undefined,
    aclApplied: row.acl_applied === 1,
    managed: row.managed === 1,
    managedSource: row.managed_source ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
