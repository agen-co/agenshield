/**
 * Zod schemas for authentication validation
 */

import { z } from 'zod';

/**
 * Passcode validation - minimum 4 characters
 */
const passcodeSchema = z.string().min(4, 'Passcode must be at least 4 characters');

/**
 * Auth status response schema
 */
export const AuthStatusResponseSchema = z.object({
  passcodeSet: z.boolean(),
  protectionEnabled: z.boolean(),
  lockedOut: z.boolean(),
  lockedUntil: z.string().optional(),
});

/**
 * Unlock request schema
 */
export const UnlockRequestSchema = z.object({
  passcode: passcodeSchema,
});

/**
 * Unlock response schema
 */
export const UnlockResponseSchema = z.object({
  success: z.boolean(),
  token: z.string().optional(),
  expiresAt: z.number().int().positive().optional(),
  error: z.string().optional(),
  remainingAttempts: z.number().int().nonnegative().optional(),
});

/**
 * Lock request schema
 */
export const LockRequestSchema = z.object({
  token: z.string().min(1),
});

/**
 * Lock response schema
 */
export const LockResponseSchema = z.object({
  success: z.boolean(),
});

/**
 * Setup passcode request schema
 */
export const SetupPasscodeRequestSchema = z.object({
  passcode: passcodeSchema,
  enableProtection: z.boolean().optional(),
});

/**
 * Setup passcode response schema
 */
export const SetupPasscodeResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Change passcode request schema
 */
export const ChangePasscodeRequestSchema = z.object({
  oldPasscode: passcodeSchema.optional(),
  newPasscode: passcodeSchema,
});

/**
 * Change passcode response schema
 */
export const ChangePasscodeResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Session schema (internal)
 */
export const SessionSchema = z.object({
  token: z.string().min(1),
  createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  clientId: z.string().optional(),
});

/**
 * Auth config schema
 */
export const AuthConfigSchema = z.object({
  sessionTtlMs: z.number().int().positive(),
  maxFailedAttempts: z.number().int().positive(),
  lockoutDurationMs: z.number().int().positive(),
});

// Note: PasscodeProtectionStateSchema is defined in state.schema.ts

/**
 * Passcode data schema (for vault)
 */
export const PasscodeDataSchema = z.object({
  hash: z.string().min(1),
  setAt: z.string(),
  changedAt: z.string().optional(),
});

// Inferred types from schemas
export type AuthStatusResponseInput = z.input<typeof AuthStatusResponseSchema>;
export type AuthStatusResponseOutput = z.output<typeof AuthStatusResponseSchema>;
export type UnlockRequestInput = z.input<typeof UnlockRequestSchema>;
export type UnlockRequestOutput = z.output<typeof UnlockRequestSchema>;
export type UnlockResponseInput = z.input<typeof UnlockResponseSchema>;
export type UnlockResponseOutput = z.output<typeof UnlockResponseSchema>;
export type LockRequestInput = z.input<typeof LockRequestSchema>;
export type LockRequestOutput = z.output<typeof LockRequestSchema>;
export type SetupPasscodeRequestInput = z.input<typeof SetupPasscodeRequestSchema>;
export type SetupPasscodeRequestOutput = z.output<typeof SetupPasscodeRequestSchema>;
export type ChangePasscodeRequestInput = z.input<typeof ChangePasscodeRequestSchema>;
export type ChangePasscodeRequestOutput = z.output<typeof ChangePasscodeRequestSchema>;
export type SessionInput = z.input<typeof SessionSchema>;
export type SessionOutput = z.output<typeof SessionSchema>;
export type PasscodeDataInput = z.input<typeof PasscodeDataSchema>;
export type PasscodeDataOutput = z.output<typeof PasscodeDataSchema>;
