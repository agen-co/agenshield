/**
 * Zod schemas for AllowedCommand validation
 */

import { z } from 'zod';

export const AllowedCommandSchema = z.object({
  name: z.string().min(1).max(100),
  paths: z.array(z.string()).default([]),
  addedAt: z.string().datetime(),
  addedBy: z.string().min(1).default('policy'),
  category: z.string().optional(),
});

export const CreateAllowedCommandSchema = AllowedCommandSchema.omit({ addedAt: true });

export type AllowedCommandInput = z.input<typeof AllowedCommandSchema>;
export type CreateAllowedCommandInput = z.input<typeof CreateAllowedCommandSchema>;
