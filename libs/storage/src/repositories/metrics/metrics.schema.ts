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
});

export type MetricsSnapshotInput = z.input<typeof MetricsSnapshotSchema>;
