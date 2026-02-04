/**
 * Zod schemas for AgenShield configuration validation
 */
import { z } from 'zod';
export declare const DaemonConfigSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    host: z.ZodDefault<z.ZodString>;
    logLevel: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
    enableHostsEntry: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    port: number;
    host: string;
    logLevel: "debug" | "info" | "warn" | "error";
    enableHostsEntry: boolean;
}, {
    port?: number | undefined;
    host?: string | undefined;
    logLevel?: "debug" | "info" | "warn" | "error" | undefined;
    enableHostsEntry?: boolean | undefined;
}>;
export declare const PolicyConfigSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<["allowlist", "denylist"]>;
    patterns: z.ZodArray<z.ZodString, "many">;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: "allowlist" | "denylist";
    id: string;
    name: string;
    patterns: string[];
    enabled: boolean;
}, {
    type: "allowlist" | "denylist";
    id: string;
    name: string;
    patterns: string[];
    enabled?: boolean | undefined;
}>;
export declare const VaultConfigSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    provider: z.ZodEnum<["local", "env"]>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    provider: "local" | "env";
}, {
    enabled: boolean;
    provider: "local" | "env";
}>;
export declare const ShieldConfigSchema: z.ZodObject<{
    version: z.ZodString;
    daemon: z.ZodObject<{
        port: z.ZodDefault<z.ZodNumber>;
        host: z.ZodDefault<z.ZodString>;
        logLevel: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
        enableHostsEntry: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
        logLevel: "debug" | "info" | "warn" | "error";
        enableHostsEntry: boolean;
    }, {
        port?: number | undefined;
        host?: string | undefined;
        logLevel?: "debug" | "info" | "warn" | "error" | undefined;
        enableHostsEntry?: boolean | undefined;
    }>;
    policies: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        type: z.ZodEnum<["allowlist", "denylist"]>;
        patterns: z.ZodArray<z.ZodString, "many">;
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        type: "allowlist" | "denylist";
        id: string;
        name: string;
        patterns: string[];
        enabled: boolean;
    }, {
        type: "allowlist" | "denylist";
        id: string;
        name: string;
        patterns: string[];
        enabled?: boolean | undefined;
    }>, "many">>;
    vault: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        provider: z.ZodEnum<["local", "env"]>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        provider: "local" | "env";
    }, {
        enabled: boolean;
        provider: "local" | "env";
    }>>;
}, "strip", z.ZodTypeAny, {
    version: string;
    daemon: {
        port: number;
        host: string;
        logLevel: "debug" | "info" | "warn" | "error";
        enableHostsEntry: boolean;
    };
    policies: {
        type: "allowlist" | "denylist";
        id: string;
        name: string;
        patterns: string[];
        enabled: boolean;
    }[];
    vault?: {
        enabled: boolean;
        provider: "local" | "env";
    } | undefined;
}, {
    version: string;
    daemon: {
        port?: number | undefined;
        host?: string | undefined;
        logLevel?: "debug" | "info" | "warn" | "error" | undefined;
        enableHostsEntry?: boolean | undefined;
    };
    policies?: {
        type: "allowlist" | "denylist";
        id: string;
        name: string;
        patterns: string[];
        enabled?: boolean | undefined;
    }[] | undefined;
    vault?: {
        enabled: boolean;
        provider: "local" | "env";
    } | undefined;
}>;
export type DaemonConfigInput = z.input<typeof DaemonConfigSchema>;
export type DaemonConfigOutput = z.output<typeof DaemonConfigSchema>;
export type PolicyConfigInput = z.input<typeof PolicyConfigSchema>;
export type ShieldConfigInput = z.input<typeof ShieldConfigSchema>;
export type ShieldConfigOutput = z.output<typeof ShieldConfigSchema>;
//# sourceMappingURL=config.schema.d.ts.map