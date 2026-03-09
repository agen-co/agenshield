/**
 * Zod schemas for MCP Server domain validation
 */

import { z } from 'zod';

const transportEnum = z.enum(['stdio', 'sse', 'streamable-http']);
const authTypeEnum = z.enum(['none', 'oauth', 'apikey', 'bearer']);
const sourceEnum = z.enum(['manual', 'cloud', 'agenco', 'workspace']);
const statusEnum = z.enum(['active', 'disabled', 'pending', 'blocked']);

export const CreateMcpServerSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/),
  description: z.string().max(1000).default(''),
  transport: transportEnum,
  url: z.string().max(2000).nullable().default(null),
  command: z.string().max(500).nullable().default(null),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  authType: authTypeEnum.default('none'),
  authConfig: z.record(z.string(), z.unknown()).nullable().default(null),
  source: sourceEnum.default('manual'),
  status: statusEnum.default('active'),
  profileId: z.string().nullable().default(null),
  configJson: z.record(z.string(), z.unknown()).nullable().default(null),
  supportedTargets: z.array(z.string()).default([]),
});

export type CreateMcpServerInput = z.input<typeof CreateMcpServerSchema>;

export const UpdateMcpServerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  transport: transportEnum.optional(),
  url: z.string().max(2000).nullable().optional(),
  command: z.string().max(500).nullable().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  authType: authTypeEnum.optional(),
  authConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  status: statusEnum.optional(),
  configJson: z.record(z.string(), z.unknown()).nullable().optional(),
  supportedTargets: z.array(z.string()).optional(),
});

export type UpdateMcpServerInput = z.input<typeof UpdateMcpServerSchema>;
