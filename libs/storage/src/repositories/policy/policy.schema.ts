/**
 * Policy schemas — Zod validation schemas and derived types
 */

import { z } from 'zod';
import { PolicyConfigSchema } from '@agenshield/ipc';

// ---- Create type ----

export type CreatePolicyInput = z.input<typeof PolicyConfigSchema>;
export { PolicyConfigSchema };

// ---- Update schema ----

export const UpdatePolicySchema = z.object({
  name: z.string().min(1).optional(),
  action: z.enum(['allow', 'deny', 'ask']).optional(),
  target: z.enum(['command', 'file', 'network', 'shell']).optional(),
  patterns: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().optional(),
  operations: z.array(z.string()).optional(),
  preset: z.string().optional(),
  scope: z.string().optional(),
  networkAccess: z.enum(['allow', 'deny', 'restrict']).optional(),
});
export type UpdatePolicyInput = z.input<typeof UpdatePolicySchema>;

export const UpdatePolicyCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdatePolicySchema,
  {
    decode: (db) => db as UpdatePolicyInput,
    encode: (data) => ({
      name: data.name,
      action: data.action,
      target: data.target,
      patterns: data.patterns !== undefined ? JSON.stringify(data.patterns) : undefined,
      enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : undefined,
      priority: data.priority,
      operations: data.operations !== undefined ? JSON.stringify(data.operations) : undefined,
      preset: data.preset,
      scope: data.scope,
      network_access: data.networkAccess,
    }),
  }
);
