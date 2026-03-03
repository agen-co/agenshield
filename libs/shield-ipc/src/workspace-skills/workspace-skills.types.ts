/**
 * Workspace skill governance types.
 *
 * Workspace skills are project-level skills found in `.claude/skills/`
 * within active workspaces. AgenShield controls access to these via
 * OS-level ACL enforcement, requiring admin approval before the agent
 * can read them.
 */

export type WorkspaceSkillStatus = 'pending' | 'approved' | 'denied' | 'removed' | 'cloud_forced';

export interface WorkspaceSkill {
  id: string;
  profileId: string;
  workspacePath: string;
  skillName: string;
  status: WorkspaceSkillStatus;
  contentHash?: string;
  backupHash?: string;
  approvedBy?: string;
  approvedAt?: string;
  cloudSkillId?: string;
  removedAt?: string;
  aclApplied: boolean;
  createdAt: string;
  updatedAt: string;
}
