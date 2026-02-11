/**
 * Zod schemas for Target domain validation
 */
import { z } from 'zod';
export declare const TargetSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    presetId: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const TargetUserSchema: z.ZodObject<{
    targetId: z.ZodString;
    userUsername: z.ZodString;
    role: z.ZodEnum<{
        broker: "broker";
        agent: "agent";
    }>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export declare const CreateTargetSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    id: z.ZodString;
    presetId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CreateTargetUserSchema: z.ZodObject<{
    targetId: z.ZodString;
    userUsername: z.ZodString;
    role: z.ZodEnum<{
        broker: "broker";
        agent: "agent";
    }>;
}, z.core.$strip>;
export type TargetInput = z.input<typeof TargetSchema>;
export type CreateTargetInput = z.input<typeof CreateTargetSchema>;
export type TargetUserInput = z.input<typeof TargetUserSchema>;
export type CreateTargetUserInput = z.input<typeof CreateTargetUserSchema>;
//# sourceMappingURL=targets.schema.d.ts.map