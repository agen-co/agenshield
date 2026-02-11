/**
 * Zod schemas for Storage domain validation
 */
import { z } from 'zod';
export declare const ScopeFilterSchema: z.ZodObject<{
    targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    userUsername: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const MetaEntrySchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodString;
}, z.core.$strip>;
export type ScopeFilterInput = z.input<typeof ScopeFilterSchema>;
export type MetaEntryInput = z.input<typeof MetaEntrySchema>;
//# sourceMappingURL=storage.schema.d.ts.map