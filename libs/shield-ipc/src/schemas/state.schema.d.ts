/**
 * Zod schemas for system state validation
 */
import { z } from 'zod';
/**
 * Daemon state schema
 */
export declare const DaemonStateSchema: z.ZodObject<{
    running: z.ZodBoolean;
    pid: z.ZodOptional<z.ZodNumber>;
    startedAt: z.ZodOptional<z.ZodString>;
    port: z.ZodNumber;
}, z.core.$strip>;
/**
 * User state schema
 */
export declare const UserStateSchema: z.ZodObject<{
    username: z.ZodString;
    uid: z.ZodNumber;
    type: z.ZodEnum<{
        broker: "broker";
        agent: "agent";
    }>;
    createdAt: z.ZodString;
    homeDir: z.ZodString;
}, z.core.$strip>;
/**
 * Group state schema
 */
export declare const GroupStateSchema: z.ZodObject<{
    name: z.ZodString;
    gid: z.ZodNumber;
    type: z.ZodEnum<{
        socket: "socket";
        workspace: "workspace";
    }>;
}, z.core.$strip>;
/**
 * AgenCo state schema
 */
export declare const AgenCoStateSchema: z.ZodObject<{
    authenticated: z.ZodBoolean;
    lastAuthAt: z.ZodOptional<z.ZodString>;
    connectedIntegrations: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/**
 * Installation state schema
 */
export declare const InstallationStateSchema: z.ZodObject<{
    preset: z.ZodString;
    baseName: z.ZodString;
    prefix: z.ZodOptional<z.ZodString>;
    wrappers: z.ZodArray<z.ZodString>;
    seatbeltInstalled: z.ZodBoolean;
}, z.core.$strip>;
/**
 * Passcode protection state schema
 */
export declare const PasscodeProtectionStateSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    allowAnonymousReadOnly: z.ZodOptional<z.ZodBoolean>;
    failedAttempts: z.ZodOptional<z.ZodNumber>;
    lockedUntil: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Complete system state schema
 */
export declare const SystemStateSchema: z.ZodObject<{
    version: z.ZodString;
    installedAt: z.ZodString;
    daemon: z.ZodObject<{
        running: z.ZodBoolean;
        pid: z.ZodOptional<z.ZodNumber>;
        startedAt: z.ZodOptional<z.ZodString>;
        port: z.ZodNumber;
    }, z.core.$strip>;
    users: z.ZodArray<z.ZodObject<{
        username: z.ZodString;
        uid: z.ZodNumber;
        type: z.ZodEnum<{
            broker: "broker";
            agent: "agent";
        }>;
        createdAt: z.ZodString;
        homeDir: z.ZodString;
    }, z.core.$strip>>;
    groups: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        gid: z.ZodNumber;
        type: z.ZodEnum<{
            socket: "socket";
            workspace: "workspace";
        }>;
    }, z.core.$strip>>;
    agenco: z.ZodObject<{
        authenticated: z.ZodBoolean;
        lastAuthAt: z.ZodOptional<z.ZodString>;
        connectedIntegrations: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    installation: z.ZodObject<{
        preset: z.ZodString;
        baseName: z.ZodString;
        prefix: z.ZodOptional<z.ZodString>;
        wrappers: z.ZodArray<z.ZodString>;
        seatbeltInstalled: z.ZodBoolean;
    }, z.core.$strip>;
    passcodeProtection: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        allowAnonymousReadOnly: z.ZodOptional<z.ZodBoolean>;
        failedAttempts: z.ZodOptional<z.ZodNumber>;
        lockedUntil: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type DaemonStateInput = z.input<typeof DaemonStateSchema>;
export type DaemonStateOutput = z.output<typeof DaemonStateSchema>;
export type UserStateInput = z.input<typeof UserStateSchema>;
export type UserStateOutput = z.output<typeof UserStateSchema>;
export type GroupStateInput = z.input<typeof GroupStateSchema>;
export type GroupStateOutput = z.output<typeof GroupStateSchema>;
export type AgenCoStateInput = z.input<typeof AgenCoStateSchema>;
export type AgenCoStateOutput = z.output<typeof AgenCoStateSchema>;
export type InstallationStateInput = z.input<typeof InstallationStateSchema>;
export type InstallationStateOutput = z.output<typeof InstallationStateSchema>;
export type PasscodeProtectionStateInput = z.input<typeof PasscodeProtectionStateSchema>;
export type PasscodeProtectionStateOutput = z.output<typeof PasscodeProtectionStateSchema>;
export type SystemStateInput = z.input<typeof SystemStateSchema>;
export type SystemStateOutput = z.output<typeof SystemStateSchema>;
//# sourceMappingURL=state.schema.d.ts.map