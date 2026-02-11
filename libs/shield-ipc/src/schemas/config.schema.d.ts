/**
 * Zod schemas for AgenShield configuration validation
 */
import { z } from 'zod';
/**
 * User definition schema
 */
export declare const UserDefinitionSchema: z.ZodObject<{
    username: z.ZodString;
    uid: z.ZodNumber;
    gid: z.ZodNumber;
    shell: z.ZodString;
    home: z.ZodString;
    realname: z.ZodString;
    groups: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/**
 * Group definition schema
 */
export declare const GroupDefinitionSchema: z.ZodObject<{
    name: z.ZodString;
    gid: z.ZodNumber;
    description: z.ZodString;
}, z.core.$strip>;
/**
 * User configuration schema
 */
export declare const UserConfigSchema: z.ZodObject<{
    agentUser: z.ZodObject<{
        username: z.ZodString;
        uid: z.ZodNumber;
        gid: z.ZodNumber;
        shell: z.ZodString;
        home: z.ZodString;
        realname: z.ZodString;
        groups: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    brokerUser: z.ZodObject<{
        username: z.ZodString;
        uid: z.ZodNumber;
        gid: z.ZodNumber;
        shell: z.ZodString;
        home: z.ZodString;
        realname: z.ZodString;
        groups: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    groups: z.ZodObject<{
        socket: z.ZodObject<{
            name: z.ZodString;
            gid: z.ZodNumber;
            description: z.ZodString;
        }, z.core.$strip>;
        workspace: z.ZodObject<{
            name: z.ZodString;
            gid: z.ZodNumber;
            description: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    prefix: z.ZodDefault<z.ZodString>;
    baseName: z.ZodDefault<z.ZodString>;
    baseUid: z.ZodDefault<z.ZodNumber>;
    baseGid: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
/**
 * Paths configuration schema
 */
export declare const PathsConfigSchema: z.ZodObject<{
    socketPath: z.ZodDefault<z.ZodString>;
    configDir: z.ZodDefault<z.ZodString>;
    policiesDir: z.ZodDefault<z.ZodString>;
    seatbeltDir: z.ZodDefault<z.ZodString>;
    logDir: z.ZodDefault<z.ZodString>;
    agentHomeDir: z.ZodDefault<z.ZodString>;
    socketDir: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
/**
 * Installation configuration schema
 */
export declare const InstallationConfigSchema: z.ZodObject<{
    users: z.ZodObject<{
        agentUser: z.ZodObject<{
            username: z.ZodString;
            uid: z.ZodNumber;
            gid: z.ZodNumber;
            shell: z.ZodString;
            home: z.ZodString;
            realname: z.ZodString;
            groups: z.ZodArray<z.ZodString>;
        }, z.core.$strip>;
        brokerUser: z.ZodObject<{
            username: z.ZodString;
            uid: z.ZodNumber;
            gid: z.ZodNumber;
            shell: z.ZodString;
            home: z.ZodString;
            realname: z.ZodString;
            groups: z.ZodArray<z.ZodString>;
        }, z.core.$strip>;
        groups: z.ZodObject<{
            socket: z.ZodObject<{
                name: z.ZodString;
                gid: z.ZodNumber;
                description: z.ZodString;
            }, z.core.$strip>;
            workspace: z.ZodObject<{
                name: z.ZodString;
                gid: z.ZodNumber;
                description: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        prefix: z.ZodDefault<z.ZodString>;
        baseName: z.ZodDefault<z.ZodString>;
        baseUid: z.ZodDefault<z.ZodNumber>;
        baseGid: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>;
    paths: z.ZodObject<{
        socketPath: z.ZodDefault<z.ZodString>;
        configDir: z.ZodDefault<z.ZodString>;
        policiesDir: z.ZodDefault<z.ZodString>;
        seatbeltDir: z.ZodDefault<z.ZodString>;
        logDir: z.ZodDefault<z.ZodString>;
        agentHomeDir: z.ZodDefault<z.ZodString>;
        socketDir: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    httpFallback: z.ZodDefault<z.ZodBoolean>;
    httpPort: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const DaemonConfigSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    host: z.ZodDefault<z.ZodString>;
    logLevel: z.ZodDefault<z.ZodEnum<{
        error: "error";
        debug: "debug";
        info: "info";
        warn: "warn";
    }>>;
    enableHostsEntry: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const PolicyConfigSchema: z.ZodObject<{
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
    patterns: z.ZodArray<z.ZodString>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    priority: z.ZodOptional<z.ZodNumber>;
    operations: z.ZodOptional<z.ZodArray<z.ZodString>>;
    preset: z.ZodOptional<z.ZodString>;
    scope: z.ZodOptional<z.ZodString>;
    networkAccess: z.ZodOptional<z.ZodEnum<{
        none: "none";
        proxy: "proxy";
        direct: "direct";
    }>>;
}, z.core.$strip>;
export declare const VaultConfigSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    provider: z.ZodEnum<{
        local: "local";
        env: "env";
    }>;
}, z.core.$strip>;
export declare const ShieldConfigSchema: z.ZodObject<{
    version: z.ZodString;
    daemon: z.ZodObject<{
        port: z.ZodDefault<z.ZodNumber>;
        host: z.ZodDefault<z.ZodString>;
        logLevel: z.ZodDefault<z.ZodEnum<{
            error: "error";
            debug: "debug";
            info: "info";
            warn: "warn";
        }>>;
        enableHostsEntry: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>;
    policies: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
        patterns: z.ZodArray<z.ZodString>;
        enabled: z.ZodDefault<z.ZodBoolean>;
        priority: z.ZodOptional<z.ZodNumber>;
        operations: z.ZodOptional<z.ZodArray<z.ZodString>>;
        preset: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodString>;
        networkAccess: z.ZodOptional<z.ZodEnum<{
            none: "none";
            proxy: "proxy";
            direct: "direct";
        }>>;
    }, z.core.$strip>>>;
    defaultAction: z.ZodOptional<z.ZodEnum<{
        deny: "deny";
        allow: "allow";
    }>>;
    vault: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        provider: z.ZodEnum<{
            local: "local";
            env: "env";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type DaemonConfigInput = z.input<typeof DaemonConfigSchema>;
export type DaemonConfigOutput = z.output<typeof DaemonConfigSchema>;
export type PolicyConfigInput = z.input<typeof PolicyConfigSchema>;
export type ShieldConfigInput = z.input<typeof ShieldConfigSchema>;
export type ShieldConfigOutput = z.output<typeof ShieldConfigSchema>;
export type UserDefinitionInput = z.input<typeof UserDefinitionSchema>;
export type UserDefinitionOutput = z.output<typeof UserDefinitionSchema>;
export type GroupDefinitionInput = z.input<typeof GroupDefinitionSchema>;
export type GroupDefinitionOutput = z.output<typeof GroupDefinitionSchema>;
export type UserConfigInput = z.input<typeof UserConfigSchema>;
export type UserConfigOutput = z.output<typeof UserConfigSchema>;
export type PathsConfigInput = z.input<typeof PathsConfigSchema>;
export type PathsConfigOutput = z.output<typeof PathsConfigSchema>;
export type InstallationConfigInput = z.input<typeof InstallationConfigSchema>;
export type InstallationConfigOutput = z.output<typeof InstallationConfigSchema>;
//# sourceMappingURL=config.schema.d.ts.map