/**
 * Profile schemas -- Zod validation schemas and derived types
 */

import { z } from 'zod';
import { CreateProfileSchema, ProfileSchema } from '@agenshield/ipc';
import type { CreateProfileInput } from '@agenshield/ipc';

// Re-export create input type
export type { CreateProfileInput };

// ---- Update schemas ----

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['global', 'target']).optional(),
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
});
export type UpdateProfileInput = z.input<typeof UpdateProfileSchema>;

export const UpdateProfileCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateProfileSchema,
  {
    decode: (db) => db as UpdateProfileInput,
    encode: (data) => ({
      name: data.name,
      type: data.type,
      target_name: data.targetName,
      preset_id: data.presetId,
      description: data.description,
      agent_username: data.agentUsername,
      agent_uid: data.agentUid,
      agent_home_dir: data.agentHomeDir,
      broker_username: data.brokerUsername,
      broker_uid: data.brokerUid,
      broker_home_dir: data.brokerHomeDir,
      broker_token: data.brokerToken,
    }),
  },
);

// Re-export schemas for convenience
export { CreateProfileSchema, ProfileSchema };
