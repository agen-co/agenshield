/**
 * Workspace skills schemas — Zod validation schemas and codecs
 */

import { z } from 'zod';

const statusEnum = z.enum(['pending', 'approved', 'denied', 'removed', 'cloud_forced']);

// ---- Create schema ----

export const CreateWorkspaceSkillSchema = z.object({
  profileId: z.string().min(1),
  workspacePath: z.string().min(1),
  skillName: z.string().min(1).max(500),
  status: statusEnum.default('pending'),
  contentHash: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
  cloudSkillId: z.string().optional(),
  aclApplied: z.boolean().default(false),
});
export type CreateWorkspaceSkillInput = z.input<typeof CreateWorkspaceSkillSchema>;

// ---- Update schema ----

export const UpdateWorkspaceSkillSchema = z.object({
  status: statusEnum.optional(),
  contentHash: z.string().nullable().optional(),
  backupHash: z.string().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  cloudSkillId: z.string().nullable().optional(),
  removedAt: z.string().nullable().optional(),
  aclApplied: z.boolean().optional(),
});
export type UpdateWorkspaceSkillInput = z.input<typeof UpdateWorkspaceSkillSchema>;

export const UpdateWorkspaceSkillCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateWorkspaceSkillSchema,
  {
    decode: (db) => db as UpdateWorkspaceSkillInput,
    encode: (data) => ({
      status: data.status,
      content_hash: data.contentHash,
      backup_hash: data.backupHash,
      approved_by: data.approvedBy,
      approved_at: data.approvedAt,
      cloud_skill_id: data.cloudSkillId,
      removed_at: data.removedAt,
      acl_applied: data.aclApplied !== undefined ? (data.aclApplied ? 1 : 0) : undefined,
    }),
  },
);
