/**
 * Zod schemas for Policy Graph validation
 */
import { z } from 'zod';
export declare const EdgeEffectSchema: z.ZodEnum<{
    deny: "deny";
    activate: "activate";
    inject_secret: "inject_secret";
    grant_network: "grant_network";
    grant_fs: "grant_fs";
    revoke: "revoke";
}>;
export declare const EdgeLifetimeSchema: z.ZodEnum<{
    process: "process";
    session: "session";
    once: "once";
    persistent: "persistent";
}>;
export declare const PolicyNodeSchema: z.ZodObject<{
    id: z.ZodString;
    policyId: z.ZodString;
    targetId: z.ZodOptional<z.ZodString>;
    userUsername: z.ZodOptional<z.ZodString>;
    dormant: z.ZodDefault<z.ZodBoolean>;
    metadata: z.ZodOptional<z.ZodUnknown>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const CreatePolicyNodeSchema: z.ZodObject<{
    metadata: z.ZodOptional<z.ZodUnknown>;
    policyId: z.ZodString;
    targetId: z.ZodOptional<z.ZodString>;
    userUsername: z.ZodOptional<z.ZodString>;
    dormant: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const PolicyEdgeSchema: z.ZodObject<{
    id: z.ZodString;
    sourceNodeId: z.ZodString;
    targetNodeId: z.ZodString;
    effect: z.ZodEnum<{
        deny: "deny";
        activate: "activate";
        inject_secret: "inject_secret";
        grant_network: "grant_network";
        grant_fs: "grant_fs";
        revoke: "revoke";
    }>;
    lifetime: z.ZodEnum<{
        process: "process";
        session: "session";
        once: "once";
        persistent: "persistent";
    }>;
    priority: z.ZodDefault<z.ZodNumber>;
    condition: z.ZodOptional<z.ZodString>;
    secretName: z.ZodOptional<z.ZodString>;
    grantPatterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
    delayMs: z.ZodDefault<z.ZodNumber>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const CreatePolicyEdgeSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    priority: z.ZodDefault<z.ZodNumber>;
    secretName: z.ZodOptional<z.ZodString>;
    effect: z.ZodEnum<{
        deny: "deny";
        activate: "activate";
        inject_secret: "inject_secret";
        grant_network: "grant_network";
        grant_fs: "grant_fs";
        revoke: "revoke";
    }>;
    lifetime: z.ZodEnum<{
        process: "process";
        session: "session";
        once: "once";
        persistent: "persistent";
    }>;
    sourceNodeId: z.ZodString;
    targetNodeId: z.ZodString;
    condition: z.ZodOptional<z.ZodString>;
    grantPatterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
    delayMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const EdgeActivationSchema: z.ZodObject<{
    id: z.ZodString;
    edgeId: z.ZodString;
    activatedAt: z.ZodString;
    expiresAt: z.ZodOptional<z.ZodString>;
    processId: z.ZodOptional<z.ZodNumber>;
    consumed: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const CreateEdgeActivationSchema: z.ZodObject<{
    expiresAt: z.ZodOptional<z.ZodString>;
    edgeId: z.ZodString;
    activatedAt: z.ZodString;
    processId: z.ZodOptional<z.ZodNumber>;
    consumed: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type PolicyNodeInput = z.input<typeof PolicyNodeSchema>;
export type CreatePolicyNodeInput = z.input<typeof CreatePolicyNodeSchema>;
export type PolicyEdgeInput = z.input<typeof PolicyEdgeSchema>;
export type CreatePolicyEdgeInput = z.input<typeof CreatePolicyEdgeSchema>;
export type EdgeActivationInput = z.input<typeof EdgeActivationSchema>;
export type CreateEdgeActivationInput = z.input<typeof CreateEdgeActivationSchema>;
//# sourceMappingURL=policy-graph.schema.d.ts.map