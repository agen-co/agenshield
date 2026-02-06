/**
 * Zod schemas for broker operations
 */

import { z } from 'zod';

export const OperationTypeSchema = z.enum([
  'http_request',
  'file_read',
  'file_write',
  'file_list',
  'exec',
  'open_url',
  'secret_inject',
  'ping',
  'policy_check',
  'events_batch',
]);

export const HttpRequestParamsSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  timeout: z.number().positive().optional(),
  followRedirects: z.boolean().optional(),
});

export const FileReadParamsSchema = z.object({
  path: z.string().min(1),
  encoding: z.string().optional(),
});

export const FileWriteParamsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.string().optional(),
  mode: z.number().optional(),
});

export const FileListParamsSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
  pattern: z.string().optional(),
});

export const ExecParamsSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeout: z.number().positive().optional(),
  shell: z.boolean().optional(),
});

export const OpenUrlParamsSchema = z.object({
  url: z.string().url(),
  browser: z.string().optional(),
});

export const SecretInjectParamsSchema = z.object({
  name: z.string().min(1),
  targetEnv: z.string().optional(),
});

export const PingParamsSchema = z.object({
  echo: z.string().optional(),
});

export const PolicyCheckParamsSchema = z.object({
  operation: OperationTypeSchema,
  target: z.string().min(1),
});

export const BrokerRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: OperationTypeSchema,
  params: z.record(z.string(), z.unknown()),
  channel: z.enum(['socket', 'http']).optional(),
});

export const BrokerErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const BrokerResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: BrokerErrorSchema.optional(),
});

// Type exports
export type OperationType = z.infer<typeof OperationTypeSchema>;
export type HttpRequestParams = z.infer<typeof HttpRequestParamsSchema>;
export type FileReadParams = z.infer<typeof FileReadParamsSchema>;
export type FileWriteParams = z.infer<typeof FileWriteParamsSchema>;
export type FileListParams = z.infer<typeof FileListParamsSchema>;
export type ExecParams = z.infer<typeof ExecParamsSchema>;
export type OpenUrlParams = z.infer<typeof OpenUrlParamsSchema>;
export type SecretInjectParams = z.infer<typeof SecretInjectParamsSchema>;
export type PingParams = z.infer<typeof PingParamsSchema>;
export type PolicyCheckParams = z.infer<typeof PolicyCheckParamsSchema>;
export type BrokerRequest = z.infer<typeof BrokerRequestSchema>;
export type BrokerError = z.infer<typeof BrokerErrorSchema>;
export type BrokerResponse = z.infer<typeof BrokerResponseSchema>;
