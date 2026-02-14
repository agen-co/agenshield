/**
 * Secrets schemas — Zod validation schemas and derived types
 */

import { z } from 'zod';

// ---- Create schema ----

export const CreateSecretSchema = z.object({
  name: z.string().min(1).max(200),
  value: z.string().min(1),
  scope: z.enum(['global', 'policed', 'standalone']).optional(),
  policyIds: z.array(z.string()).optional(),
});
export type CreateSecretInput = z.input<typeof CreateSecretSchema>;

// ---- Update schema ----

export const UpdateSecretSchema = z.object({
  value: z.string().min(1).optional(),
  scope: z.enum(['global', 'policed', 'standalone']).optional(),
  policyIds: z.array(z.string()).optional(),
});
export type UpdateSecretInput = z.input<typeof UpdateSecretSchema>;

export const UpdateSecretCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateSecretSchema,
  {
    decode: (db) => db as UpdateSecretInput,
    encode: (data) => ({
      scope: data.scope,
    }),
  },
);
