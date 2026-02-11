/**
 * Zod schemas for AgenCo API validation
 */
import { z } from 'zod';
/**
 * Auth start request schema
 */
export declare const AgenCoAuthStartRequestSchema: z.ZodObject<{
    scopes: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
/**
 * Auth start response schema
 */
export declare const AgenCoAuthStartResponseSchema: z.ZodObject<{
    authUrl: z.ZodString;
    state: z.ZodString;
    callbackPort: z.ZodNumber;
}, z.core.$strip>;
/**
 * Auth callback request schema
 */
export declare const AgenCoAuthCallbackRequestSchema: z.ZodObject<{
    code: z.ZodString;
    state: z.ZodString;
}, z.core.$strip>;
/**
 * Auth callback response schema
 */
export declare const AgenCoAuthCallbackResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Auth status response schema
 */
export declare const AgenCoAuthStatusResponseSchema: z.ZodObject<{
    authenticated: z.ZodBoolean;
    expired: z.ZodBoolean;
    expiresAt: z.ZodNullable<z.ZodString>;
    connectedIntegrations: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/**
 * Tool run request schema
 */
export declare const AgenCoToolRunRequestSchema: z.ZodObject<{
    integration: z.ZodString;
    tool: z.ZodString;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
/**
 * Tool run response schema
 */
export declare const AgenCoToolRunResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Tool list request schema
 */
export declare const AgenCoToolListRequestSchema: z.ZodObject<{
    integration: z.ZodOptional<z.ZodString>;
    connectedOnly: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Tool schema
 */
export declare const AgenCoToolSchema: z.ZodObject<{
    integration: z.ZodString;
    tool: z.ZodString;
    description: z.ZodString;
    connected: z.ZodOptional<z.ZodBoolean>;
    connectUrl: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Tool list response schema
 */
export declare const AgenCoToolListResponseSchema: z.ZodObject<{
    tools: z.ZodArray<z.ZodObject<{
        integration: z.ZodString;
        tool: z.ZodString;
        description: z.ZodString;
        connected: z.ZodOptional<z.ZodBoolean>;
        connectUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Tool search request schema
 */
export declare const AgenCoToolSearchRequestSchema: z.ZodObject<{
    query: z.ZodString;
    integration: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Integrations list request schema
 */
export declare const AgenCoIntegrationsListRequestSchema: z.ZodObject<{
    category: z.ZodOptional<z.ZodString>;
    search: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Integration action schema
 */
export declare const AgenCoIntegrationActionSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
}, z.core.$strip>;
/**
 * Integration schema
 */
export declare const AgenCoIntegrationSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    category: z.ZodString;
    toolsCount: z.ZodNumber;
    actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/**
 * Integrations list response schema
 */
export declare const AgenCoIntegrationsListResponseSchema: z.ZodObject<{
    integrations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
        category: z.ZodString;
        toolsCount: z.ZodNumber;
        actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    totalCount: z.ZodNumber;
}, z.core.$strip>;
/**
 * Connected integration schema
 */
export declare const AgenCoConnectedIntegrationSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    connectedAt: z.ZodString;
    status: z.ZodString;
    account: z.ZodOptional<z.ZodString>;
    requiresReauth: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Connected integrations response schema
 */
export declare const AgenCoConnectedIntegrationsResponseSchema: z.ZodObject<{
    integrations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        connectedAt: z.ZodString;
        status: z.ZodString;
        account: z.ZodOptional<z.ZodString>;
        requiresReauth: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Connect integration request schema
 */
export declare const AgenCoConnectIntegrationRequestSchema: z.ZodObject<{
    integration: z.ZodString;
    scopes: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
/**
 * Connect integration response schema
 */
export declare const AgenCoConnectIntegrationResponseSchema: z.ZodObject<{
    status: z.ZodEnum<{
        connected: "connected";
        auth_required: "auth_required";
        already_connected: "already_connected";
    }>;
    oauthUrl: z.ZodOptional<z.ZodString>;
    expiresIn: z.ZodOptional<z.ZodNumber>;
    instructions: z.ZodOptional<z.ZodString>;
    account: z.ZodOptional<z.ZodString>;
    connectedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AgenCoAuthStartRequestInput = z.input<typeof AgenCoAuthStartRequestSchema>;
export type AgenCoAuthStartResponseOutput = z.output<typeof AgenCoAuthStartResponseSchema>;
export type AgenCoAuthCallbackRequestInput = z.input<typeof AgenCoAuthCallbackRequestSchema>;
export type AgenCoToolRunRequestInput = z.input<typeof AgenCoToolRunRequestSchema>;
//# sourceMappingURL=agenco.schema.d.ts.map