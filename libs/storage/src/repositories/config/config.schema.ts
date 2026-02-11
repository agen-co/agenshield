/**
 * Config schemas — Zod validation schemas and derived types
 */

import { z } from 'zod';

// ---- Update schema ----

export const UpdateConfigSchema = z.object({
  version: z.string().nullable().optional(),
  daemonPort: z.number().int().positive().nullable().optional(),
  daemonHost: z.string().nullable().optional(),
  daemonLogLevel: z.string().nullable().optional(),
  daemonEnableHostsEntry: z.boolean().nullable().optional(),
  defaultAction: z.string().nullable().optional(),
  vaultEnabled: z.boolean().nullable().optional(),
  vaultProvider: z.string().nullable().optional(),
  skillsJson: z.string().nullable().optional(),
  soulJson: z.string().nullable().optional(),
  brokerJson: z.string().nullable().optional(),
});
export type ConfigData = z.input<typeof UpdateConfigSchema>;
