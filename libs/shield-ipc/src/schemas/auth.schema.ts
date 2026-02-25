/**
 * Zod schemas for JWT authentication validation
 */

import { z } from 'zod';

/**
 * Auth status response schema
 */
export const AuthStatusResponseSchema = z.object({
  authenticated: z.boolean(),
  role: z.enum(['admin', 'broker']).optional(),
  expiresAt: z.number().int().positive().optional(),
});

/**
 * Sudo login request schema
 */
export const SudoLoginRequestSchema = z.object({
  username: z.string().optional(),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Sudo login response schema
 */
export const SudoLoginResponseSchema = z.object({
  success: z.boolean(),
  token: z.string().optional(),
  expiresAt: z.number().int().positive().optional(),
  error: z.string().optional(),
});

/**
 * Refresh response schema
 */
export const RefreshResponseSchema = z.object({
  success: z.boolean(),
  token: z.string().optional(),
  expiresAt: z.number().int().positive().optional(),
  error: z.string().optional(),
});

/**
 * Auth config schema
 */
export const AuthConfigSchema = z.object({
  maxFailedAttempts: z.number().int().positive(),
  lockoutDurationMs: z.number().int().positive(),
});

/**
 * Passcode data schema (legacy — kept for vault compatibility)
 */
export const PasscodeDataSchema = z.object({
  hash: z.string().min(1),
  setAt: z.string(),
  changedAt: z.string().optional(),
});

// Inferred types from schemas
export type AuthStatusResponseInput = z.input<typeof AuthStatusResponseSchema>;
export type AuthStatusResponseOutput = z.output<typeof AuthStatusResponseSchema>;
export type SudoLoginRequestInput = z.input<typeof SudoLoginRequestSchema>;
export type SudoLoginRequestOutput = z.output<typeof SudoLoginRequestSchema>;
export type SudoLoginResponseInput = z.input<typeof SudoLoginResponseSchema>;
export type SudoLoginResponseOutput = z.output<typeof SudoLoginResponseSchema>;
export type RefreshResponseInput = z.input<typeof RefreshResponseSchema>;
export type RefreshResponseOutput = z.output<typeof RefreshResponseSchema>;
export type PasscodeDataInput = z.input<typeof PasscodeDataSchema>;
export type PasscodeDataOutput = z.output<typeof PasscodeDataSchema>;
