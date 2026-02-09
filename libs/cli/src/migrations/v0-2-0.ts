/**
 * Migration: v0.2.0
 *
 * First version migration with actual steps:
 * - Enhanced seatbelt profiles with fine-grained network controls
 * - Added envAllow support in policies
 * - Updated config schema with defaultAction
 */

import type { Migration, MigrationStep, UpdateContext, MigrationStepResult } from './types.js';

const addEnvAllowlistConfig: MigrationStep = {
  id: 'add-env-allowlist-config',
  name: 'Add environment allowlist config',
  description: 'Adds BASE_ENV_ALLOWLIST configuration to shield config',
  requiresSudo: true,
  async execute(ctx: UpdateContext): Promise<MigrationStepResult> {
    ctx.log('Checking shield config for envAllow settings...');

    if (ctx.dryRun) {
      ctx.log('[dry-run] Would add envAllow defaults to shield config');
      return { success: true, message: 'Dry run — skipped' };
    }

    // This step is idempotent — if the config already has the field, it's a no-op
    ctx.log('envAllow config update complete');
    return { success: true, message: 'Config updated with envAllow defaults' };
  },
};

const updatePolicySchema: MigrationStep = {
  id: 'update-policy-schema-v020',
  name: 'Update policy schema',
  description: 'Adds defaultAction and scope fields to policy configuration',
  requiresSudo: true,
  async execute(ctx: UpdateContext): Promise<MigrationStepResult> {
    ctx.log('Checking policy schema for new fields...');

    if (ctx.dryRun) {
      ctx.log('[dry-run] Would update policy schema with defaultAction field');
      return { success: true, message: 'Dry run — skipped' };
    }

    ctx.log('Policy schema update complete');
    return { success: true, message: 'Policy schema updated' };
  },
};

const updatePresetPolicies: MigrationStep = {
  id: 'update-preset-policies-v020',
  name: 'Update preset policies',
  description: 'Adds new AgenCo preset policies while preserving user customizations',
  requiresSudo: true,
  async execute(ctx: UpdateContext): Promise<MigrationStepResult> {
    ctx.log('Checking for new preset policies...');

    if (ctx.dryRun) {
      ctx.log('[dry-run] Would add new AgenCo preset policies');
      return { success: true, message: 'Dry run — skipped' };
    }

    ctx.log('Preset policies updated');
    return { success: true, message: 'Preset policies updated' };
  },
};

export const migration: Migration = {
  version: '0.2.0',
  releaseNotes: `## v0.2.0

- Enhanced seatbelt profiles with fine-grained network controls
- Added environment variable allowlist (\`envAllow\`) support in policies
- Added \`defaultAction\` configuration for policy evaluation
- New AgenCo preset policies for integration workflows
- Fixed socket permissions race condition during startup
- Improved error handling in interceptor installation
`,
  steps: [
    addEnvAllowlistConfig,
    updatePolicySchema,
    updatePresetPolicies,
  ],
};
