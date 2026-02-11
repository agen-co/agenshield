/**
 * Zod schemas for Policy Graph validation
 */

import { z } from 'zod';

export const EdgeEffectSchema = z.enum([
  'activate', 'deny', 'inject_secret', 'grant_network', 'grant_fs', 'revoke',
]);

export const EdgeLifetimeSchema = z.enum([
  'session', 'process', 'once', 'persistent',
]);

export const PolicyNodeSchema = z.object({
  id: z.string().uuid(),
  policyId: z.string().min(1),
  targetId: z.string().optional(),
  userUsername: z.string().optional(),
  dormant: z.boolean().default(false),
  metadata: z.unknown().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const CreatePolicyNodeSchema = PolicyNodeSchema.omit({ id: true, createdAt: true, updatedAt: true });

export const PolicyEdgeSchema = z.object({
  id: z.string().uuid(),
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  effect: EdgeEffectSchema,
  lifetime: EdgeLifetimeSchema,
  priority: z.number().int().default(0),
  condition: z.string().optional(),
  secretName: z.string().optional(),
  grantPatterns: z.array(z.string()).optional(),
  delayMs: z.number().int().nonnegative().default(0),
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const CreatePolicyEdgeSchema = PolicyEdgeSchema.omit({ id: true, createdAt: true, updatedAt: true });

export const EdgeActivationSchema = z.object({
  id: z.string().uuid(),
  edgeId: z.string().uuid(),
  activatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  processId: z.number().int().optional(),
  consumed: z.boolean().default(false),
});
export const CreateEdgeActivationSchema = EdgeActivationSchema.omit({ id: true });

export type PolicyNodeInput = z.input<typeof PolicyNodeSchema>;
export type CreatePolicyNodeInput = z.input<typeof CreatePolicyNodeSchema>;
export type PolicyEdgeInput = z.input<typeof PolicyEdgeSchema>;
export type CreatePolicyEdgeInput = z.input<typeof CreatePolicyEdgeSchema>;
export type EdgeActivationInput = z.input<typeof EdgeActivationSchema>;
export type CreateEdgeActivationInput = z.input<typeof CreateEdgeActivationSchema>;
