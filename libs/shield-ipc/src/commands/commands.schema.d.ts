/**
 * Zod schemas for AllowedCommand validation
 */
import { z } from 'zod';
export declare const AllowedCommandSchema: z.ZodObject<{
    name: z.ZodString;
    paths: z.ZodDefault<z.ZodArray<z.ZodString>>;
    addedAt: z.ZodString;
    addedBy: z.ZodDefault<z.ZodString>;
    category: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CreateAllowedCommandSchema: z.ZodObject<{
    name: z.ZodString;
    paths: z.ZodDefault<z.ZodArray<z.ZodString>>;
    category: z.ZodOptional<z.ZodString>;
    addedBy: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type AllowedCommandInput = z.input<typeof AllowedCommandSchema>;
export type CreateAllowedCommandInput = z.input<typeof CreateAllowedCommandSchema>;
//# sourceMappingURL=commands.schema.d.ts.map