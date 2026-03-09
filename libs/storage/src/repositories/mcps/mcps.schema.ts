/**
 * MCP server schemas — Zod validation schemas and codecs
 */

import { z } from 'zod';
import { CreateMcpServerSchema } from '@agenshield/ipc';

// ---- Create type ----

export type { CreateMcpServerInput } from '@agenshield/ipc';

// ---- Update schema ----

export const UpdateMcpServerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  transport: z.enum(['stdio', 'sse', 'streamable-http']).optional(),
  url: z.string().max(2000).nullable().optional(),
  command: z.string().max(500).nullable().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  authType: z.enum(['none', 'oauth', 'apikey', 'bearer']).optional(),
  authConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(['active', 'disabled', 'pending', 'blocked']).optional(),
  configJson: z.record(z.string(), z.unknown()).nullable().optional(),
  supportedTargets: z.array(z.string()).optional(),
});
export type UpdateMcpServerInput = z.input<typeof UpdateMcpServerSchema>;

export const UpdateMcpServerCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateMcpServerSchema,
  {
    decode: (db) => db as UpdateMcpServerInput,
    encode: (data) => ({
      name: data.name,
      description: data.description,
      transport: data.transport,
      url: data.url,
      command: data.command,
      args: data.args !== undefined ? JSON.stringify(data.args) : undefined,
      env: data.env !== undefined ? JSON.stringify(data.env) : undefined,
      headers: data.headers !== undefined ? JSON.stringify(data.headers) : undefined,
      auth_type: data.authType,
      auth_config: data.authConfig !== undefined
        ? (data.authConfig !== null ? JSON.stringify(data.authConfig) : null)
        : undefined,
      status: data.status,
      config_json: data.configJson !== undefined
        ? (data.configJson !== null ? JSON.stringify(data.configJson) : null)
        : undefined,
      supported_targets: data.supportedTargets !== undefined ? JSON.stringify(data.supportedTargets) : undefined,
    }),
  },
);

export { CreateMcpServerSchema };
