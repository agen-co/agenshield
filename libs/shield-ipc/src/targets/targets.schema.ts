/**
 * Zod schemas for Target domain validation
 */

import { z } from 'zod';

export const TargetSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(100),
  presetId: z.string().optional(),
  description: z.string().max(500).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const TargetUserSchema = z.object({
  targetId: z.string().min(1),
  userUsername: z.string().min(1),
  role: z.enum(['agent', 'broker']),
  createdAt: z.string().datetime(),
});

export const CreateTargetSchema = TargetSchema.omit({ createdAt: true, updatedAt: true });
export const CreateTargetUserSchema = TargetUserSchema.omit({ createdAt: true });

export type TargetInput = z.input<typeof TargetSchema>;
export type CreateTargetInput = z.input<typeof CreateTargetSchema>;
export type TargetUserInput = z.input<typeof TargetUserSchema>;
export type CreateTargetUserInput = z.input<typeof CreateTargetUserSchema>;
