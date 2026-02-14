/**
 * Zod schemas for Storage domain validation
 */

import { z } from 'zod';

export const ScopeFilterSchema = z.object({
  profileId: z.string().nullable().optional(),
});

export const MetaEntrySchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export type ScopeFilterInput = z.input<typeof ScopeFilterSchema>;
export type MetaEntryInput = z.input<typeof MetaEntrySchema>;
