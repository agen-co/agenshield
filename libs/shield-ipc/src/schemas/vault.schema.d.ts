/**
 * Zod schemas for vault validation
 */
import { z } from 'zod';
/**
 * AgenCo secrets schema
 */
export declare const AgenCoSecretsSchema: z.ZodObject<{
    accessToken: z.ZodString;
    refreshToken: z.ZodString;
    expiresAt: z.ZodNumber;
    clientId: z.ZodString;
    clientSecret: z.ZodString;
}, z.core.$strip>;
/**
 * Vault contents schema
 */
export declare const VaultContentsSchema: z.ZodObject<{
    agenco: z.ZodOptional<z.ZodObject<{
        accessToken: z.ZodString;
        refreshToken: z.ZodString;
        expiresAt: z.ZodNumber;
        clientId: z.ZodString;
        clientSecret: z.ZodString;
    }, z.core.$strip>>;
    envSecrets: z.ZodRecord<z.ZodString, z.ZodString>;
    sensitivePatterns: z.ZodArray<z.ZodString>;
    passcode: z.ZodOptional<z.ZodObject<{
        hash: z.ZodString;
        setAt: z.ZodString;
        changedAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    installationKey: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AgenCoSecretsInput = z.input<typeof AgenCoSecretsSchema>;
export type AgenCoSecretsOutput = z.output<typeof AgenCoSecretsSchema>;
export type VaultContentsInput = z.input<typeof VaultContentsSchema>;
export type VaultContentsOutput = z.output<typeof VaultContentsSchema>;
//# sourceMappingURL=vault.schema.d.ts.map