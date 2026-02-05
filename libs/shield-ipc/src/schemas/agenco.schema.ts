/**
 * Zod schemas for AgenCo API validation
 */

import { z } from 'zod';

/**
 * Auth start request schema
 */
export const AgenCoAuthStartRequestSchema = z.object({
  scopes: z.array(z.string()).optional(),
});

/**
 * Auth start response schema
 */
export const AgenCoAuthStartResponseSchema = z.object({
  authUrl: z.string().url(),
  state: z.string().min(1),
  callbackPort: z.number().int().min(1024).max(65535),
});

/**
 * Auth callback request schema
 */
export const AgenCoAuthCallbackRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/**
 * Auth callback response schema
 */
export const AgenCoAuthCallbackResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Auth status response schema
 */
export const AgenCoAuthStatusResponseSchema = z.object({
  authenticated: z.boolean(),
  expired: z.boolean(),
  expiresAt: z.string().nullable(),
  connectedIntegrations: z.array(z.string()),
});

/**
 * Tool run request schema
 */
export const AgenCoToolRunRequestSchema = z.object({
  integration: z.string().min(1),
  tool: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Tool run response schema
 */
export const AgenCoToolRunResponseSchema = z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

/**
 * Tool list request schema
 */
export const AgenCoToolListRequestSchema = z.object({
  integration: z.string().optional(),
  connectedOnly: z.boolean().optional(),
});

/**
 * Tool schema
 */
export const AgenCoToolSchema = z.object({
  integration: z.string(),
  tool: z.string(),
  description: z.string(),
  connected: z.boolean().optional(),
  connectUrl: z.string().optional(),
});

/**
 * Tool list response schema
 */
export const AgenCoToolListResponseSchema = z.object({
  tools: z.array(AgenCoToolSchema),
});

/**
 * Tool search request schema
 */
export const AgenCoToolSearchRequestSchema = z.object({
  query: z.string().min(1),
  integration: z.string().optional(),
});

/**
 * Integrations list request schema
 */
export const AgenCoIntegrationsListRequestSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
});

/**
 * Integration action schema
 */
export const AgenCoIntegrationActionSchema = z.object({
  name: z.string(),
  description: z.string(),
});

/**
 * Integration schema
 */
export const AgenCoIntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  toolsCount: z.number().int().nonnegative(),
  actions: z.array(AgenCoIntegrationActionSchema).optional(),
});

/**
 * Integrations list response schema
 */
export const AgenCoIntegrationsListResponseSchema = z.object({
  integrations: z.array(AgenCoIntegrationSchema),
  totalCount: z.number().int().nonnegative(),
});

/**
 * Connected integration schema
 */
export const AgenCoConnectedIntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectedAt: z.string(),
  status: z.string(),
  account: z.string().optional(),
  requiresReauth: z.boolean().optional(),
});

/**
 * Connected integrations response schema
 */
export const AgenCoConnectedIntegrationsResponseSchema = z.object({
  integrations: z.array(AgenCoConnectedIntegrationSchema),
});

/**
 * Connect integration request schema
 */
export const AgenCoConnectIntegrationRequestSchema = z.object({
  integration: z.string().min(1),
  scopes: z.array(z.string()).optional(),
});

/**
 * Connect integration response schema
 */
export const AgenCoConnectIntegrationResponseSchema = z.object({
  status: z.enum(['auth_required', 'already_connected', 'connected']),
  oauthUrl: z.string().url().optional(),
  expiresIn: z.number().optional(),
  instructions: z.string().optional(),
  account: z.string().optional(),
  connectedAt: z.string().optional(),
});

// Inferred types from schemas
export type AgenCoAuthStartRequestInput = z.input<typeof AgenCoAuthStartRequestSchema>;
export type AgenCoAuthStartResponseOutput = z.output<typeof AgenCoAuthStartResponseSchema>;
export type AgenCoAuthCallbackRequestInput = z.input<typeof AgenCoAuthCallbackRequestSchema>;
export type AgenCoToolRunRequestInput = z.input<typeof AgenCoToolRunRequestSchema>;
