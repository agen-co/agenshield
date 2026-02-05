/**
 * Zod schemas for system state validation
 */

import { z } from 'zod';

/**
 * Daemon state schema
 */
export const DaemonStateSchema = z.object({
  running: z.boolean(),
  pid: z.number().int().positive().optional(),
  startedAt: z.string().optional(),
  port: z.number().int().min(1024).max(65535),
});

/**
 * User state schema
 */
export const UserStateSchema = z.object({
  username: z.string().min(1).max(32).regex(/^[a-z_][a-z0-9_-]*$/),
  uid: z.number().int().min(500).max(65534),
  type: z.enum(['agent', 'broker']),
  createdAt: z.string(),
  homeDir: z.string().min(1),
});

/**
 * Group state schema
 */
export const GroupStateSchema = z.object({
  name: z.string().min(1).max(32).regex(/^[a-z_][a-z0-9_-]*$/),
  gid: z.number().int().min(500).max(65534),
  type: z.enum(['socket', 'workspace']),
});

/**
 * AgenCo state schema
 */
export const AgenCoStateSchema = z.object({
  authenticated: z.boolean(),
  lastAuthAt: z.string().optional(),
  connectedIntegrations: z.array(z.string()),
});

/**
 * Installation state schema
 */
export const InstallationStateSchema = z.object({
  preset: z.string().min(1),
  baseName: z.string().min(1),
  prefix: z.string().optional(),
  wrappers: z.array(z.string()),
  seatbeltInstalled: z.boolean(),
});

/**
 * Passcode protection state schema
 */
export const PasscodeProtectionStateSchema = z.object({
  enabled: z.boolean(),
  allowAnonymousReadOnly: z.boolean().optional(),
  failedAttempts: z.number().int().nonnegative().optional(),
  lockedUntil: z.string().optional(),
});

/**
 * Complete system state schema
 */
export const SystemStateSchema = z.object({
  version: z.string().min(1),
  installedAt: z.string(),
  daemon: DaemonStateSchema,
  users: z.array(UserStateSchema),
  groups: z.array(GroupStateSchema),
  agenco: AgenCoStateSchema,
  installation: InstallationStateSchema,
  passcodeProtection: PasscodeProtectionStateSchema.optional(),
});

// Inferred types from schemas
export type DaemonStateInput = z.input<typeof DaemonStateSchema>;
export type DaemonStateOutput = z.output<typeof DaemonStateSchema>;
export type UserStateInput = z.input<typeof UserStateSchema>;
export type UserStateOutput = z.output<typeof UserStateSchema>;
export type GroupStateInput = z.input<typeof GroupStateSchema>;
export type GroupStateOutput = z.output<typeof GroupStateSchema>;
export type AgenCoStateInput = z.input<typeof AgenCoStateSchema>;
export type AgenCoStateOutput = z.output<typeof AgenCoStateSchema>;
export type InstallationStateInput = z.input<typeof InstallationStateSchema>;
export type InstallationStateOutput = z.output<typeof InstallationStateSchema>;
export type PasscodeProtectionStateInput = z.input<typeof PasscodeProtectionStateSchema>;
export type PasscodeProtectionStateOutput = z.output<typeof PasscodeProtectionStateSchema>;
export type SystemStateInput = z.input<typeof SystemStateSchema>;
export type SystemStateOutput = z.output<typeof SystemStateSchema>;
