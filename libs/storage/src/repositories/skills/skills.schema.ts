/**
 * Skills schemas — Zod validation schemas and derived types
 */

import { z } from 'zod';
import { CreateSkillSchema, CreateSkillVersionSchema, CreateSkillFileSchema, CreateSkillInstallationSchema } from '@agenshield/ipc';
import type { CreateSkillInput, CreateSkillVersionInput, CreateSkillInstallationInput } from '@agenshield/ipc';

// ---- Filter / param types ----

export interface SkillsGetAllFilter {
  source?: string;
}

export interface SkillInstallationsFilter {
  skillVersionId?: string;
  profileId?: string;
}

export interface GetVersionParams {
  skillId: string;
  version: string;
}

export interface RegisterFilesParams {
  versionId: string;
  files: Array<{ relativePath: string; fileHash: string; sizeBytes: number }>;
}

export interface UpdateFileHashParams {
  fileId: string;
  newHash: string;
}

// Re-export create input types
export type { CreateSkillInput, CreateSkillVersionInput, CreateSkillInstallationInput };

// ---- Update schemas ----

export const UpdateSkillSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  author: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  source: z.enum(['marketplace', 'watcher', 'manual', 'integration', 'unknown']).optional(),
  remoteId: z.string().optional(),
  isPublic: z.boolean().optional(),
});
export type UpdateSkillInput = z.input<typeof UpdateSkillSchema>;

export const UpdateSkillCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateSkillSchema,
  {
    decode: (db) => db as UpdateSkillInput,
    encode: (data) => ({
      name: data.name,
      author: data.author,
      description: data.description,
      homepage: data.homepage,
      tags: data.tags !== undefined ? JSON.stringify(data.tags) : undefined,
      source: data.source,
      remote_id: data.remoteId,
      is_public: data.isPublic !== undefined ? (data.isPublic ? 1 : 0) : undefined,
    }),
  },
);

export const UpdateSkillVersionAnalysisSchema = z.object({
  status: z.enum(['pending', 'analyzing', 'complete', 'error']),
  json: z.unknown().optional(),
  analyzedAt: z.string().datetime().optional(),
});
export type UpdateSkillVersionAnalysisInput = z.input<typeof UpdateSkillVersionAnalysisSchema>;

export const UpdateInstallationStatusSchema = z.object({
  status: z.enum(['active', 'disabled', 'quarantined', 'pending']),
});
export type UpdateInstallationStatusInput = z.input<typeof UpdateInstallationStatusSchema>;

// Re-export create schemas for convenience
export { CreateSkillSchema, CreateSkillVersionSchema, CreateSkillFileSchema, CreateSkillInstallationSchema };
