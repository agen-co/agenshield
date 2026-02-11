/**
 * Zod schemas for Activity event validation
 */
import { z } from 'zod';
export declare const ActivityEventSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodNumber>;
    targetId: z.ZodOptional<z.ZodString>;
    type: z.ZodString;
    timestamp: z.ZodString;
    data: z.ZodUnknown;
    createdAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CreateActivityEventSchema: z.ZodObject<{
    type: z.ZodString;
    data: z.ZodUnknown;
    timestamp: z.ZodString;
    targetId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ActivityEventInput = z.input<typeof ActivityEventSchema>;
export type CreateActivityEventInput = z.input<typeof CreateActivityEventSchema>;
//# sourceMappingURL=activity.schema.d.ts.map