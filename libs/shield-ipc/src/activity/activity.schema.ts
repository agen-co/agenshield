/**
 * Zod schemas for Activity event validation
 */

import { z } from 'zod';

export const ActivityEventSchema = z.object({
  id: z.number().int().positive().optional(),
  targetId: z.string().optional(),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  data: z.unknown(),
  createdAt: z.string().datetime().optional(),
});

export const CreateActivityEventSchema = ActivityEventSchema.omit({ id: true, createdAt: true });

export type ActivityEventInput = z.input<typeof ActivityEventSchema>;
export type CreateActivityEventInput = z.input<typeof CreateActivityEventSchema>;
