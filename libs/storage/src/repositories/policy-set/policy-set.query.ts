/**
 * SQL queries for policy sets
 */

export const Q = {
  insert: `
    INSERT INTO policy_sets (id, name, parent_id, profile_id, enforced, created_at, updated_at)
    VALUES (@id, @name, @parentId, @profileId, @enforced, @createdAt, @updatedAt)
  `,

  selectById: `SELECT * FROM policy_sets WHERE id = ?`,

  selectByProfileId: `SELECT * FROM policy_sets WHERE profile_id = ? ORDER BY name`,

  selectAll: `SELECT * FROM policy_sets ORDER BY name`,

  selectChildren: `SELECT * FROM policy_sets WHERE parent_id = ? ORDER BY name`,

  deleteById: `DELETE FROM policy_sets WHERE id = ?`,

  // Members
  addMember: `
    INSERT OR IGNORE INTO policy_set_members (policy_set_id, policy_id)
    VALUES (@policySetId, @policyId)
  `,

  removeMember: `
    DELETE FROM policy_set_members WHERE policy_set_id = @policySetId AND policy_id = @policyId
  `,

  selectMembers: `
    SELECT policy_id FROM policy_set_members WHERE policy_set_id = ?
  `,

  selectMemberships: `
    SELECT policy_set_id FROM policy_set_members WHERE policy_id = ?
  `,
};
