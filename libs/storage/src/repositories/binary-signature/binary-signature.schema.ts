/**
 * Binary signature schemas — Zod validation schemas and codecs
 */

import { z } from 'zod';

// ---- Create schema ----

export const CreateSignatureSchema = z.object({
  sha256: z.string().min(64).max(64),
  packageName: z.string().min(1).max(500),
  version: z.string().max(100).optional(),
  platform: z.string().max(50).optional(),
  source: z.enum(['cloud', 'local']).default('cloud'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateSignatureInput = z.input<typeof CreateSignatureSchema>;

// ---- Upsert batch schema ----

export const UpsertBatchSchema = z.object({
  signatures: z.array(CreateSignatureSchema).min(1).max(10_000),
});
export type UpsertBatchInput = z.input<typeof UpsertBatchSchema>;

// ---- Update schema ----

export const UpdateSignatureSchema = z.object({
  packageName: z.string().min(1).max(500).optional(),
  version: z.string().max(100).optional(),
  platform: z.string().max(50).optional(),
  source: z.enum(['cloud', 'local']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateSignatureInput = z.input<typeof UpdateSignatureSchema>;

export const UpdateSignatureCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateSignatureSchema,
  {
    decode: (db) => db as UpdateSignatureInput,
    encode: (data) => ({
      package_name: data.packageName,
      version: data.version,
      platform: data.platform,
      source: data.source,
      metadata: data.metadata !== undefined ? JSON.stringify(data.metadata) : undefined,
    }),
  },
);
