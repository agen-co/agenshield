/**
 * Target schemas — Zod validation schemas and derived types
 */

import { z } from 'zod';
import { CreateTargetSchema, CreateTargetUserSchema, TargetSchema, TargetUserSchema } from '@agenshield/ipc';
import type { CreateTargetInput, CreateTargetUserInput } from '@agenshield/ipc';

// ---- Param types ----

export interface RemoveUserParams {
  targetId: string;
  userUsername: string;
}

// Re-export create input types
export type { CreateTargetInput, CreateTargetUserInput };

// ---- Update schemas ----

export const UpdateTargetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  presetId: z.string().optional(),
  description: z.string().max(500).optional(),
});
export type UpdateTargetInput = z.input<typeof UpdateTargetSchema>;

export const UpdateTargetCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateTargetSchema,
  {
    decode: (db) => db as UpdateTargetInput,
    encode: (data) => ({
      name: data.name,
      preset_id: data.presetId,
      description: data.description,
    }),
  },
);

// Re-export create/full schemas for convenience
export { CreateTargetSchema, CreateTargetUserSchema, TargetSchema, TargetUserSchema };
