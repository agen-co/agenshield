/**
 * Zod schemas for authentication validation
 */
import { z } from 'zod';
/**
 * Auth status response schema
 */
export declare const AuthStatusResponseSchema: z.ZodObject<{
    passcodeSet: z.ZodBoolean;
    protectionEnabled: z.ZodBoolean;
    allowAnonymousReadOnly: z.ZodBoolean;
    lockedOut: z.ZodBoolean;
    lockedUntil: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Unlock request schema
 */
export declare const UnlockRequestSchema: z.ZodObject<{
    passcode: z.ZodString;
}, z.core.$strip>;
/**
 * Unlock response schema
 */
export declare const UnlockResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    token: z.ZodOptional<z.ZodString>;
    expiresAt: z.ZodOptional<z.ZodNumber>;
    error: z.ZodOptional<z.ZodString>;
    remainingAttempts: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/**
 * Lock request schema
 */
export declare const LockRequestSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
/**
 * Lock response schema
 */
export declare const LockResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
}, z.core.$strip>;
/**
 * Setup passcode request schema
 */
export declare const SetupPasscodeRequestSchema: z.ZodObject<{
    passcode: z.ZodString;
    enableProtection: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Setup passcode response schema
 */
export declare const SetupPasscodeResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Change passcode request schema
 */
export declare const ChangePasscodeRequestSchema: z.ZodObject<{
    oldPasscode: z.ZodOptional<z.ZodString>;
    newPasscode: z.ZodString;
}, z.core.$strip>;
/**
 * Change passcode response schema
 */
export declare const ChangePasscodeResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Session schema (internal)
 */
export declare const SessionSchema: z.ZodObject<{
    token: z.ZodString;
    createdAt: z.ZodNumber;
    expiresAt: z.ZodNumber;
    clientId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Auth config schema
 */
export declare const AuthConfigSchema: z.ZodObject<{
    sessionTtlMs: z.ZodNumber;
    maxFailedAttempts: z.ZodNumber;
    lockoutDurationMs: z.ZodNumber;
}, z.core.$strip>;
/**
 * Passcode data schema (for vault)
 */
export declare const PasscodeDataSchema: z.ZodObject<{
    hash: z.ZodString;
    setAt: z.ZodString;
    changedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AuthStatusResponseInput = z.input<typeof AuthStatusResponseSchema>;
export type AuthStatusResponseOutput = z.output<typeof AuthStatusResponseSchema>;
export type UnlockRequestInput = z.input<typeof UnlockRequestSchema>;
export type UnlockRequestOutput = z.output<typeof UnlockRequestSchema>;
export type UnlockResponseInput = z.input<typeof UnlockResponseSchema>;
export type UnlockResponseOutput = z.output<typeof UnlockResponseSchema>;
export type LockRequestInput = z.input<typeof LockRequestSchema>;
export type LockRequestOutput = z.output<typeof LockRequestSchema>;
export type SetupPasscodeRequestInput = z.input<typeof SetupPasscodeRequestSchema>;
export type SetupPasscodeRequestOutput = z.output<typeof SetupPasscodeRequestSchema>;
export type ChangePasscodeRequestInput = z.input<typeof ChangePasscodeRequestSchema>;
export type ChangePasscodeRequestOutput = z.output<typeof ChangePasscodeRequestSchema>;
export type SessionInput = z.input<typeof SessionSchema>;
export type SessionOutput = z.output<typeof SessionSchema>;
export type PasscodeDataInput = z.input<typeof PasscodeDataSchema>;
export type PasscodeDataOutput = z.output<typeof PasscodeDataSchema>;
//# sourceMappingURL=auth.schema.d.ts.map