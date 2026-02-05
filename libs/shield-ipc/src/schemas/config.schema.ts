/**
 * Zod schemas for AgenShield configuration validation
 */

import { z } from 'zod';

/**
 * User definition schema
 */
export const UserDefinitionSchema = z.object({
  username: z.string().min(1).max(32).regex(/^[a-z_][a-z0-9_-]*$/),
  uid: z.number().int().min(500).max(65534),
  gid: z.number().int().min(500).max(65534),
  shell: z.string().min(1),
  home: z.string().min(1),
  realname: z.string().min(1).max(100),
  groups: z.array(z.string().regex(/^[a-z_][a-z0-9_-]*$/)),
});

/**
 * Group definition schema
 */
export const GroupDefinitionSchema = z.object({
  name: z.string().min(1).max(32).regex(/^[a-z_][a-z0-9_-]*$/),
  gid: z.number().int().min(500).max(65534),
  description: z.string().min(1).max(100),
});

/**
 * User configuration schema
 */
export const UserConfigSchema = z.object({
  agentUser: UserDefinitionSchema,
  brokerUser: UserDefinitionSchema,
  groups: z.object({
    socket: GroupDefinitionSchema,
    workspace: GroupDefinitionSchema,
  }),
  prefix: z.string().max(20).default(''),
  baseName: z.string().min(1).max(20).regex(/^[a-z][a-z0-9_]*$/).default('agenshield'),
  baseUid: z.number().int().min(500).max(65000).default(5200),
  baseGid: z.number().int().min(500).max(65000).default(5100),
});

/**
 * Paths configuration schema
 */
export const PathsConfigSchema = z.object({
  socketPath: z.string().default('/var/run/agenshield/agenshield.sock'),
  configDir: z.string().default('/opt/agenshield/config'),
  policiesDir: z.string().default('/opt/agenshield/policies'),
  seatbeltDir: z.string().default('/etc/agenshield/seatbelt'),
  logDir: z.string().default('/var/log/agenshield'),
  agentHomeDir: z.string().default('/Users/agenshield_agent'),
  socketDir: z.string().default('/var/run/agenshield'),
});

/**
 * Installation configuration schema
 */
export const InstallationConfigSchema = z.object({
  users: UserConfigSchema,
  paths: PathsConfigSchema,
  httpFallback: z.boolean().default(true),
  httpPort: z.number().int().min(1024).max(65535).default(6969),
});

export const DaemonConfigSchema = z.object({
  port: z.number().min(1).max(65535).default(6969),
  host: z.string().default('localhost'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  enableHostsEntry: z.boolean().default(false),
});

export const PolicyConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  action: z.enum(['allow', 'deny', 'approval']),
  target: z.enum(['skill', 'command', 'url']),
  patterns: z.array(z.string()),
  enabled: z.boolean().default(true),
});

export const VaultConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['local', 'env']),
});

export const ShieldConfigSchema = z.object({
  version: z.string(),
  daemon: DaemonConfigSchema,
  policies: z.array(PolicyConfigSchema).default([]),
  vault: VaultConfigSchema.optional(),
});

// Inferred types from schemas
export type DaemonConfigInput = z.input<typeof DaemonConfigSchema>;
export type DaemonConfigOutput = z.output<typeof DaemonConfigSchema>;
export type PolicyConfigInput = z.input<typeof PolicyConfigSchema>;
export type ShieldConfigInput = z.input<typeof ShieldConfigSchema>;
export type ShieldConfigOutput = z.output<typeof ShieldConfigSchema>;

// User configuration types
export type UserDefinitionInput = z.input<typeof UserDefinitionSchema>;
export type UserDefinitionOutput = z.output<typeof UserDefinitionSchema>;
export type GroupDefinitionInput = z.input<typeof GroupDefinitionSchema>;
export type GroupDefinitionOutput = z.output<typeof GroupDefinitionSchema>;
export type UserConfigInput = z.input<typeof UserConfigSchema>;
export type UserConfigOutput = z.output<typeof UserConfigSchema>;
export type PathsConfigInput = z.input<typeof PathsConfigSchema>;
export type PathsConfigOutput = z.output<typeof PathsConfigSchema>;
export type InstallationConfigInput = z.input<typeof InstallationConfigSchema>;
export type InstallationConfigOutput = z.output<typeof InstallationConfigSchema>;
