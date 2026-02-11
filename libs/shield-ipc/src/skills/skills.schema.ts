/**
 * Zod schemas for Skill domain validation
 */

import { z } from 'zod';

export const SkillSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9][a-z0-9-]*$/),
  author: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  source: z.enum(['marketplace', 'watcher', 'manual', 'integration', 'unknown']).default('unknown'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const CreateSkillSchema = SkillSchema.omit({ id: true, createdAt: true, updatedAt: true });

export const SkillVersionSchema = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid(),
  version: z.string().min(1).max(50),
  folderPath: z.string().min(1),
  contentHash: z.string().max(128),
  hashUpdatedAt: z.string().datetime(),
  approval: z.enum(['approved', 'quarantined', 'unknown']).default('unknown'),
  approvedAt: z.string().datetime().optional(),
  trusted: z.boolean().default(false),
  metadataJson: z.unknown().optional(),
  analysisStatus: z.enum(['pending', 'analyzing', 'complete', 'error']).default('pending'),
  analysisJson: z.unknown().optional(),
  analyzedAt: z.string().datetime().optional(),
  requiredBins: z.array(z.string()).default([]),
  requiredEnv: z.array(z.string()).default([]),
  extractedCommands: z.array(z.unknown()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const CreateSkillVersionSchema = SkillVersionSchema.omit({ id: true, createdAt: true, updatedAt: true });

export const SkillFileSchema = z.object({
  id: z.string().uuid(),
  skillVersionId: z.string().uuid(),
  relativePath: z.string().min(1).max(500),
  fileHash: z.string().max(128),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const CreateSkillFileSchema = SkillFileSchema.omit({ id: true, createdAt: true, updatedAt: true });

export const SkillInstallationSchema = z.object({
  id: z.string().uuid(),
  skillVersionId: z.string().uuid(),
  targetId: z.string().optional(),
  userUsername: z.string().optional(),
  status: z.enum(['active', 'disabled', 'quarantined', 'pending']).default('active'),
  wrapperPath: z.string().optional(),
  installedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const CreateSkillInstallationSchema = SkillInstallationSchema.omit({ id: true, installedAt: true, updatedAt: true });

export type SkillInput = z.input<typeof SkillSchema>;
export type CreateSkillInput = z.input<typeof CreateSkillSchema>;
export type SkillVersionInput = z.input<typeof SkillVersionSchema>;
export type CreateSkillVersionInput = z.input<typeof CreateSkillVersionSchema>;
export type SkillFileInput = z.input<typeof SkillFileSchema>;
export type CreateSkillFileInput = z.input<typeof CreateSkillFileSchema>;
export type SkillInstallationInput = z.input<typeof SkillInstallationSchema>;
export type CreateSkillInstallationInput = z.input<typeof CreateSkillInstallationSchema>;
