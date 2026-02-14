/**
 * Zod schemas for Profile domain validation
 */

import { z } from 'zod';

export const ProfileSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(100),
  type: z.enum(['global', 'target']).default('target'),
  targetName: z.string().max(100).optional(),
  presetId: z.string().optional(),
  description: z.string().max(500).optional(),
  agentUsername: z.string().max(100).optional(),
  agentUid: z.number().int().nonnegative().optional(),
  agentHomeDir: z.string().max(500).optional(),
  brokerUsername: z.string().max(100).optional(),
  brokerUid: z.number().int().nonnegative().optional(),
  brokerHomeDir: z.string().max(500).optional(),
  brokerToken: z.string().length(64).regex(/^[a-f0-9]+$/).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CreateProfileSchema = ProfileSchema.omit({ createdAt: true, updatedAt: true });

export type ProfileInput = z.input<typeof ProfileSchema>;
export type CreateProfileInput = z.input<typeof CreateProfileSchema>;
