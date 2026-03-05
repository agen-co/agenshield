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
