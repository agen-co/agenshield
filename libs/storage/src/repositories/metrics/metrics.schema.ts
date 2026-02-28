/**
 * Metrics snapshot Zod schema — validation for persisting system metrics.
 */

import { z } from 'zod/v4';

export const MetricsSnapshotSchema = z.object({
  timestamp: z.number().int().positive(),
  cpuPercent: z.number().min(0).max(100),
  memPercent: z.number().min(0).max(100),
  diskPercent: z.number().min(0).max(100),
  netUp: z.number().min(0),
  netDown: z.number().min(0),
  targetId: z.string().max(100).optional(),
  elMin: z.number().min(0).optional(),
  elMax: z.number().min(0).optional(),
  elMean: z.number().min(0).optional(),
  elP50: z.number().min(0).optional(),
  elP99: z.number().min(0).optional(),
});

export type MetricsSnapshotInput = z.input<typeof MetricsSnapshotSchema>;
