/**
 * Vault schemas — Zod validation schemas and derived types
 */

import { z } from 'zod';

// ---- Create schemas ----

export const CreateSecretSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  scope: z.string().optional(),
  policyIds: z.array(z.string()).optional(),
  targetId: z.string().optional(),
  userUsername: z.string().optional(),
});
export type CreateSecretInput = z.input<typeof CreateSecretSchema>;

// ---- Update schemas ----

export const UpdateSecretSchema = z.object({
  name: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  scope: z.string().optional(),
  policyIds: z.array(z.string()).optional(),
});
export type UpdateSecretInput = z.input<typeof UpdateSecretSchema>;

// ---- Param types for single-object methods ----

export interface SetKvParams {
  key: string;
  value: string;
}

export interface GetKvParams {
  key: string;
}

export interface DeleteKvParams {
  key: string;
}

export interface GetSecretByNameParams {
  name: string;
}

export const UpdateSecretCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateSecretSchema,
  {
    decode: (db) => db as UpdateSecretInput,
    encode: (data) => ({
      name: data.name,
      scope: data.scope,
      // value_encrypted handled separately in repository (needs encryption)
    }),
  }
);
