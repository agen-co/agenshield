/**
 * Zod schemas for vault validation
 */

import { z } from 'zod';
import { PasscodeDataSchema } from './auth.schema';

/**
 * AgentLink secrets schema
 */
export const AgentLinkSecretsSchema = z.object({
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
  agentlink: AgentLinkSecretsSchema.optional(),
  envSecrets: z.record(z.string()),
  sensitivePatterns: z.array(z.string()),
  passcode: PasscodeDataSchema.optional(),
});

// Inferred types from schemas
export type AgentLinkSecretsInput = z.input<typeof AgentLinkSecretsSchema>;
export type AgentLinkSecretsOutput = z.output<typeof AgentLinkSecretsSchema>;
export type VaultContentsInput = z.input<typeof VaultContentsSchema>;
export type VaultContentsOutput = z.output<typeof VaultContentsSchema>;
