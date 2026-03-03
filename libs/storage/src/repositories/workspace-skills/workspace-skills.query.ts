/**
 * Workspace skills SQL queries
 */

const TABLE = 'workspace_skills';

export const Q = {
  insert: `
    INSERT INTO ${TABLE} (id, profile_id, workspace_path, skill_name, status, content_hash, approved_by, approved_at, cloud_skill_id, acl_applied, created_at, updated_at)
    VALUES (@id, @profileId, @workspacePath, @skillName, @status, @contentHash, @approvedBy, @approvedAt, @cloudSkillId, @aclApplied, @createdAt, @updatedAt)`,

  selectById: `SELECT * FROM ${TABLE} WHERE id = ?`,

  selectByKey: `SELECT * FROM ${TABLE} WHERE workspace_path = @workspacePath AND skill_name = @skillName`,

  selectByWorkspace: `SELECT * FROM ${TABLE} WHERE workspace_path = ? ORDER BY skill_name`,

  selectByStatus: `SELECT * FROM ${TABLE} WHERE status = ? ORDER BY workspace_path, skill_name`,

  selectAllActive: `SELECT * FROM ${TABLE} WHERE status != 'removed' ORDER BY workspace_path, skill_name`,

  selectPending: `SELECT * FROM ${TABLE} WHERE status = 'pending' ORDER BY created_at`,

  selectApprovedNames: `SELECT skill_name FROM ${TABLE} WHERE workspace_path = ? AND status IN ('approved', 'cloud_forced')`,

  countByStatus: `SELECT COUNT(*) as count FROM ${TABLE} WHERE status = ?`,

  deleteById: `DELETE FROM ${TABLE} WHERE id = ?`,
} as const;
