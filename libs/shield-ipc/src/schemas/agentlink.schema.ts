/**
 * Zod schemas for AgentLink API validation
 */

import { z } from 'zod';

/**
 * Auth start request schema
 */
export const AgentLinkAuthStartRequestSchema = z.object({
  scopes: z.array(z.string()).optional(),
});

/**
 * Auth start response schema
 */
export const AgentLinkAuthStartResponseSchema = z.object({
  authUrl: z.string().url(),
  state: z.string().min(1),
  callbackPort: z.number().int().min(1024).max(65535),
});

/**
 * Auth callback request schema
 */
export const AgentLinkAuthCallbackRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/**
 * Auth callback response schema
 */
export const AgentLinkAuthCallbackResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * Auth status response schema
 */
export const AgentLinkAuthStatusResponseSchema = z.object({
  authenticated: z.boolean(),
  expired: z.boolean(),
  expiresAt: z.string().nullable(),
  connectedIntegrations: z.array(z.string()),
});

/**
 * Tool run request schema
 */
export const AgentLinkToolRunRequestSchema = z.object({
  integration: z.string().min(1),
  tool: z.string().min(1),
  params: z.record(z.unknown()).optional(),
});

/**
 * Tool run response schema
 */
export const AgentLinkToolRunResponseSchema = z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

/**
 * Tool list request schema
 */
export const AgentLinkToolListRequestSchema = z.object({
  integration: z.string().optional(),
  connectedOnly: z.boolean().optional(),
});

/**
 * Tool schema
 */
export const AgentLinkToolSchema = z.object({
  integration: z.string(),
  tool: z.string(),
  description: z.string(),
  connected: z.boolean().optional(),
  connectUrl: z.string().optional(),
});

/**
 * Tool list response schema
 */
export const AgentLinkToolListResponseSchema = z.object({
  tools: z.array(AgentLinkToolSchema),
});

/**
 * Tool search request schema
 */
export const AgentLinkToolSearchRequestSchema = z.object({
  query: z.string().min(1),
  integration: z.string().optional(),
});

/**
 * Integrations list request schema
 */
export const AgentLinkIntegrationsListRequestSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
});

/**
 * Integration action schema
 */
export const AgentLinkIntegrationActionSchema = z.object({
  name: z.string(),
  description: z.string(),
});

/**
 * Integration schema
 */
export const AgentLinkIntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  toolsCount: z.number().int().nonnegative(),
  actions: z.array(AgentLinkIntegrationActionSchema).optional(),
});

/**
 * Integrations list response schema
 */
export const AgentLinkIntegrationsListResponseSchema = z.object({
  integrations: z.array(AgentLinkIntegrationSchema),
  totalCount: z.number().int().nonnegative(),
});

/**
 * Connected integration schema
 */
export const AgentLinkConnectedIntegrationSchema = z.object({
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
export const AgentLinkConnectedIntegrationsResponseSchema = z.object({
  integrations: z.array(AgentLinkConnectedIntegrationSchema),
});

/**
 * Connect integration request schema
 */
export const AgentLinkConnectIntegrationRequestSchema = z.object({
  integration: z.string().min(1),
  scopes: z.array(z.string()).optional(),
});

/**
 * Connect integration response schema
 */
export const AgentLinkConnectIntegrationResponseSchema = z.object({
  status: z.enum(['auth_required', 'already_connected', 'connected']),
  oauthUrl: z.string().url().optional(),
  expiresIn: z.number().optional(),
  instructions: z.string().optional(),
  account: z.string().optional(),
  connectedAt: z.string().optional(),
});

// Inferred types from schemas
export type AgentLinkAuthStartRequestInput = z.input<typeof AgentLinkAuthStartRequestSchema>;
export type AgentLinkAuthStartResponseOutput = z.output<typeof AgentLinkAuthStartResponseSchema>;
export type AgentLinkAuthCallbackRequestInput = z.input<typeof AgentLinkAuthCallbackRequestSchema>;
export type AgentLinkToolRunRequestInput = z.input<typeof AgentLinkToolRunRequestSchema>;
