/**
 * Zod schemas for policy set CRUD
 */

import { z } from 'zod';

export const CreatePolicySetSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().optional(),
  profileId: z.string().optional(),
  enforced: z.boolean().optional().default(false),
});

export type CreatePolicySetInput = z.input<typeof CreatePolicySetSchema>;

export const UpdatePolicySetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parentId: z.string().nullable().optional(),
  enforced: z.boolean().optional(),
});

export type UpdatePolicySetInput = z.input<typeof UpdatePolicySetSchema>;

export const UpdatePolicySetCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdatePolicySetSchema,
  {
    decode: (db) => db as UpdatePolicySetInput,
    encode: (data) => ({
      name: data.name,
      parent_id: data.parentId,
      enforced: data.enforced !== undefined ? (data.enforced ? 1 : 0) : undefined,
    }),
  },
);
