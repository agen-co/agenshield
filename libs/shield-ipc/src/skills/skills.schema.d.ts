/**
 * Zod schemas for Skill domain validation
 */
import { z } from 'zod';
export declare const SkillSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodString;
    author: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    homepage: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    source: z.ZodDefault<z.ZodEnum<{
        unknown: "unknown";
        integration: "integration";
        marketplace: "marketplace";
        watcher: "watcher";
        manual: "manual";
    }>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const CreateSkillSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    homepage: z.ZodOptional<z.ZodString>;
    slug: z.ZodString;
    author: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    source: z.ZodDefault<z.ZodEnum<{
        unknown: "unknown";
        integration: "integration";
        marketplace: "marketplace";
        watcher: "watcher";
        manual: "manual";
    }>>;
}, z.core.$strip>;
export declare const SkillVersionSchema: z.ZodObject<{
    id: z.ZodString;
    skillId: z.ZodString;
    version: z.ZodString;
    folderPath: z.ZodString;
    contentHash: z.ZodString;
    hashUpdatedAt: z.ZodString;
    approval: z.ZodDefault<z.ZodEnum<{
        unknown: "unknown";
        approved: "approved";
        quarantined: "quarantined";
    }>>;
    approvedAt: z.ZodOptional<z.ZodString>;
    trusted: z.ZodDefault<z.ZodBoolean>;
    metadataJson: z.ZodOptional<z.ZodUnknown>;
    analysisStatus: z.ZodDefault<z.ZodEnum<{
        complete: "complete";
        error: "error";
        pending: "pending";
        analyzing: "analyzing";
    }>>;
    analysisJson: z.ZodOptional<z.ZodUnknown>;
    analyzedAt: z.ZodOptional<z.ZodString>;
    requiredBins: z.ZodDefault<z.ZodArray<z.ZodString>>;
    requiredEnv: z.ZodDefault<z.ZodArray<z.ZodString>>;
    extractedCommands: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const CreateSkillVersionSchema: z.ZodObject<{
    approval: z.ZodDefault<z.ZodEnum<{
        unknown: "unknown";
        approved: "approved";
        quarantined: "quarantined";
    }>>;
    version: z.ZodString;
    skillId: z.ZodString;
    folderPath: z.ZodString;
    contentHash: z.ZodString;
    hashUpdatedAt: z.ZodString;
    approvedAt: z.ZodOptional<z.ZodString>;
    trusted: z.ZodDefault<z.ZodBoolean>;
    metadataJson: z.ZodOptional<z.ZodUnknown>;
    analysisStatus: z.ZodDefault<z.ZodEnum<{
        complete: "complete";
        error: "error";
        pending: "pending";
        analyzing: "analyzing";
    }>>;
    analysisJson: z.ZodOptional<z.ZodUnknown>;
    analyzedAt: z.ZodOptional<z.ZodString>;
    requiredBins: z.ZodDefault<z.ZodArray<z.ZodString>>;
    requiredEnv: z.ZodDefault<z.ZodArray<z.ZodString>>;
    extractedCommands: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
}, z.core.$strip>;
export declare const SkillFileSchema: z.ZodObject<{
    id: z.ZodString;
    skillVersionId: z.ZodString;
    relativePath: z.ZodString;
    fileHash: z.ZodString;
    sizeBytes: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const CreateSkillFileSchema: z.ZodObject<{
    skillVersionId: z.ZodString;
    relativePath: z.ZodString;
    fileHash: z.ZodString;
    sizeBytes: z.ZodNumber;
}, z.core.$strip>;
export declare const SkillInstallationSchema: z.ZodObject<{
    id: z.ZodString;
    skillVersionId: z.ZodString;
    targetId: z.ZodOptional<z.ZodString>;
    userUsername: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        pending: "pending";
        quarantined: "quarantined";
        active: "active";
        disabled: "disabled";
    }>>;
    wrapperPath: z.ZodOptional<z.ZodString>;
    installedAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const CreateSkillInstallationSchema: z.ZodObject<{
    status: z.ZodDefault<z.ZodEnum<{
        pending: "pending";
        quarantined: "quarantined";
        active: "active";
        disabled: "disabled";
    }>>;
    targetId: z.ZodOptional<z.ZodString>;
    userUsername: z.ZodOptional<z.ZodString>;
    skillVersionId: z.ZodString;
    wrapperPath: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SkillInput = z.input<typeof SkillSchema>;
export type CreateSkillInput = z.input<typeof CreateSkillSchema>;
export type SkillVersionInput = z.input<typeof SkillVersionSchema>;
export type CreateSkillVersionInput = z.input<typeof CreateSkillVersionSchema>;
export type SkillFileInput = z.input<typeof SkillFileSchema>;
export type CreateSkillFileInput = z.input<typeof CreateSkillFileSchema>;
export type SkillInstallationInput = z.input<typeof SkillInstallationSchema>;
export type CreateSkillInstallationInput = z.input<typeof CreateSkillInstallationSchema>;
//# sourceMappingURL=skills.schema.d.ts.map