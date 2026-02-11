/**
 * Policy Graph schemas — Zod validation schemas and derived types
 */

import { z } from 'zod';
import { CreatePolicyNodeSchema, CreatePolicyEdgeSchema, CreateEdgeActivationSchema, EdgeEffectSchema, EdgeLifetimeSchema } from '@agenshield/ipc';
import type { CreatePolicyNodeInput, CreatePolicyEdgeInput } from '@agenshield/ipc';

// ---- Param types ----

export interface ActivateEdgeParams {
  edgeId: string;
  expiresAt?: string;
  processId?: number;
}

export interface ValidateAcyclicParams {
  sourceId: string;
  targetId: string;
}

// Re-export create input types
export type { CreatePolicyNodeInput, CreatePolicyEdgeInput };

// ---- Update schemas ----

export const UpdateNodeSchema = z.object({
  dormant: z.boolean().optional(),
  metadata: z.unknown().optional(),
});
export type UpdateNodeInput = z.input<typeof UpdateNodeSchema>;

export const UpdateEdgeSchema = z.object({
  effect: EdgeEffectSchema.optional(),
  lifetime: EdgeLifetimeSchema.optional(),
  priority: z.number().int().optional(),
  condition: z.string().optional(),
  secretName: z.string().optional(),
  grantPatterns: z.array(z.string()).optional(),
  delayMs: z.number().int().nonnegative().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateEdgeInput = z.input<typeof UpdateEdgeSchema>;

export const UpdateNodeCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateNodeSchema,
  {
    decode: (db) => db as UpdateNodeInput,
    encode: (data) => ({
      dormant: data.dormant !== undefined ? (data.dormant ? 1 : 0) : undefined,
      metadata: data.metadata !== undefined ? JSON.stringify(data.metadata) : undefined,
    }),
  }
);

export const UpdateEdgeCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateEdgeSchema,
  {
    decode: (db) => db as UpdateEdgeInput,
    encode: (data) => ({
      effect: data.effect,
      lifetime: data.lifetime,
      priority: data.priority,
      condition: data.condition,
      secret_name: data.secretName,
      grant_patterns: data.grantPatterns !== undefined ? JSON.stringify(data.grantPatterns) : undefined,
      delay_ms: data.delayMs,
      enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : undefined,
    }),
  }
);

// Re-export create schemas for convenience
export { CreatePolicyNodeSchema, CreatePolicyEdgeSchema, CreateEdgeActivationSchema };
