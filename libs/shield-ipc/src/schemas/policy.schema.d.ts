/**
 * Zod schemas for policy types
 */
import { z } from 'zod';
export declare const PolicyRuleSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    action: z.ZodEnum<{
        deny: "deny";
        allow: "allow";
        approval: "approval";
    }>;
    target: z.ZodEnum<{
        command: "command";
        skill: "skill";
        url: "url";
        filesystem: "filesystem";
    }>;
    operations: z.ZodArray<z.ZodEnum<{
        http_request: "http_request";
        file_read: "file_read";
        file_write: "file_write";
        file_list: "file_list";
        exec: "exec";
        open_url: "open_url";
        secret_inject: "secret_inject";
        ping: "ping";
        policy_check: "policy_check";
        events_batch: "events_batch";
    }>>;
    patterns: z.ZodArray<z.ZodString>;
    enabled: z.ZodBoolean;
    priority: z.ZodOptional<z.ZodNumber>;
    scope: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const FsConstraintsSchema: z.ZodObject<{
    allowedPaths: z.ZodArray<z.ZodString>;
    deniedPatterns: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const NetworkConstraintsSchema: z.ZodObject<{
    allowedHosts: z.ZodArray<z.ZodString>;
    deniedHosts: z.ZodArray<z.ZodString>;
    allowedPorts: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>;
export declare const EnvInjectionRuleSchema: z.ZodObject<{
    secretName: z.ZodString;
    targetEnv: z.ZodString;
    operations: z.ZodArray<z.ZodEnum<{
        http_request: "http_request";
        file_read: "file_read";
        file_write: "file_write";
        file_list: "file_list";
        exec: "exec";
        open_url: "open_url";
        secret_inject: "secret_inject";
        ping: "ping";
        policy_check: "policy_check";
        events_batch: "events_batch";
    }>>;
}, z.core.$strip>;
export declare const PolicyConfigurationSchema: z.ZodObject<{
    version: z.ZodString;
    rules: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        action: z.ZodEnum<{
            deny: "deny";
            allow: "allow";
            approval: "approval";
        }>;
        target: z.ZodEnum<{
            command: "command";
            skill: "skill";
            url: "url";
            filesystem: "filesystem";
        }>;
        operations: z.ZodArray<z.ZodEnum<{
            http_request: "http_request";
            file_read: "file_read";
            file_write: "file_write";
            file_list: "file_list";
            exec: "exec";
            open_url: "open_url";
            secret_inject: "secret_inject";
            ping: "ping";
            policy_check: "policy_check";
            events_batch: "events_batch";
        }>>;
        patterns: z.ZodArray<z.ZodString>;
        enabled: z.ZodBoolean;
        priority: z.ZodOptional<z.ZodNumber>;
        scope: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    defaultAction: z.ZodEnum<{
        deny: "deny";
        allow: "allow";
    }>;
    fsConstraints: z.ZodOptional<z.ZodObject<{
        allowedPaths: z.ZodArray<z.ZodString>;
        deniedPatterns: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    networkConstraints: z.ZodOptional<z.ZodObject<{
        allowedHosts: z.ZodArray<z.ZodString>;
        deniedHosts: z.ZodArray<z.ZodString>;
        allowedPorts: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>>;
    envInjection: z.ZodOptional<z.ZodArray<z.ZodObject<{
        secretName: z.ZodString;
        targetEnv: z.ZodString;
        operations: z.ZodArray<z.ZodEnum<{
            http_request: "http_request";
            file_read: "file_read";
            file_write: "file_write";
            file_list: "file_list";
            exec: "exec";
            open_url: "open_url";
            secret_inject: "secret_inject";
            ping: "ping";
            policy_check: "policy_check";
            events_batch: "events_batch";
        }>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const PolicyEvaluationResultSchema: z.ZodObject<{
    allowed: z.ZodBoolean;
    policyId: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const ChannelRestrictionSchema: z.ZodObject<{
    operation: z.ZodEnum<{
        http_request: "http_request";
        file_read: "file_read";
        file_write: "file_write";
        file_list: "file_list";
        exec: "exec";
        open_url: "open_url";
        secret_inject: "secret_inject";
        ping: "ping";
        policy_check: "policy_check";
        events_batch: "events_batch";
    }>;
    allowedChannels: z.ZodArray<z.ZodEnum<{
        socket: "socket";
        http: "http";
    }>>;
}, z.core.$strip>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type FsConstraints = z.infer<typeof FsConstraintsSchema>;
export type NetworkConstraints = z.infer<typeof NetworkConstraintsSchema>;
export type EnvInjectionRule = z.infer<typeof EnvInjectionRuleSchema>;
export type PolicyConfiguration = z.infer<typeof PolicyConfigurationSchema>;
export type PolicyEvaluationResult = z.infer<typeof PolicyEvaluationResultSchema>;
export type ChannelRestriction = z.infer<typeof ChannelRestrictionSchema>;
//# sourceMappingURL=policy.schema.d.ts.map