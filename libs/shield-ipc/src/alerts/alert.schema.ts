/**
 * Zod schemas for Alert validation
 */

import { z } from 'zod';

export const AlertSeveritySchema = z.enum(['critical', 'warning', 'info']);

export const AlertSchema = z.object({
  id: z.number().int().positive().optional(),
  activityEventId: z.number().int().positive(),
  profileId: z.string().optional(),
  eventType: z.string().min(1),
  severity: AlertSeveritySchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  navigationTarget: z.string().min(1),
  details: z.unknown().optional(),
  acknowledgedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime().optional(),
});

export const CreateAlertSchema = AlertSchema.omit({
  id: true,
  acknowledgedAt: true,
  createdAt: true,
});

export type AlertInput = z.input<typeof AlertSchema>;
export type CreateAlertInput = z.input<typeof CreateAlertSchema>;
