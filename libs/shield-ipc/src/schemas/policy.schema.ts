/**
 * Zod schemas for policy types
 */

import { z } from 'zod';
import { OperationTypeSchema } from './ops.schema';

export const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['allowlist', 'denylist']),
  operations: z.array(OperationTypeSchema),
  patterns: z.array(z.string()),
  enabled: z.boolean(),
  priority: z.number().optional(),
});

export const FsConstraintsSchema = z.object({
  allowedPaths: z.array(z.string()),
  deniedPatterns: z.array(z.string()),
});

export const NetworkConstraintsSchema = z.object({
  allowedHosts: z.array(z.string()),
  deniedHosts: z.array(z.string()),
  allowedPorts: z.array(z.number().int().positive()),
});

export const EnvInjectionRuleSchema = z.object({
  secretName: z.string().min(1),
  targetEnv: z.string().min(1),
  operations: z.array(OperationTypeSchema),
});

export const PolicyConfigurationSchema = z.object({
  version: z.string(),
  rules: z.array(PolicyRuleSchema),
  defaultAction: z.enum(['allow', 'deny']),
  fsConstraints: FsConstraintsSchema.optional(),
  networkConstraints: NetworkConstraintsSchema.optional(),
  envInjection: z.array(EnvInjectionRuleSchema).optional(),
});

export const PolicyEvaluationResultSchema = z.object({
  allowed: z.boolean(),
  policyId: z.string().optional(),
  reason: z.string().optional(),
  durationMs: z.number().optional(),
});

export const ChannelRestrictionSchema = z.object({
  operation: OperationTypeSchema,
  allowedChannels: z.array(z.enum(['socket', 'http'])),
});

// Type exports
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type FsConstraints = z.infer<typeof FsConstraintsSchema>;
export type NetworkConstraints = z.infer<typeof NetworkConstraintsSchema>;
export type EnvInjectionRule = z.infer<typeof EnvInjectionRuleSchema>;
export type PolicyConfiguration = z.infer<typeof PolicyConfigurationSchema>;
export type PolicyEvaluationResult = z.infer<typeof PolicyEvaluationResultSchema>;
export type ChannelRestriction = z.infer<typeof ChannelRestrictionSchema>;
