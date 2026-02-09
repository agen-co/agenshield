/**
 * Zod schemas for vault validation
 */

import { z } from 'zod';
import { PasscodeDataSchema } from './auth.schema';

/**
 * AgenCo secrets schema
 */
export const AgenCoSecretsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int().positive(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

/**
 * Vault contents schema
 */
export const VaultContentsSchema = z.object({
  agenco: AgenCoSecretsSchema.optional(),
  envSecrets: z.record(z.string(), z.string()),
  sensitivePatterns: z.array(z.string()),
  passcode: PasscodeDataSchema.optional(),
  installationKey: z.string().optional(),
});

// Inferred types from schemas
export type AgenCoSecretsInput = z.input<typeof AgenCoSecretsSchema>;
export type AgenCoSecretsOutput = z.output<typeof AgenCoSecretsSchema>;
export type VaultContentsInput = z.input<typeof VaultContentsSchema>;
export type VaultContentsOutput = z.output<typeof VaultContentsSchema>;
