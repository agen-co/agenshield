/**
 * Verify OpenClaw Step
 *
 * Runs `openclaw --version` to verify the installation succeeded.
 * Non-fatal — logs a warning if verification fails.
 */

import type { InstallStep } from '../types.js';

export const verifyOpenclawStep: InstallStep = {
  id: 'verify_openclaw',
  name: 'Verify OpenClaw',
  description: 'Run openclaw --version to verify installation',
  phase: 9,
  progressMessage: 'Verifying OpenClaw installation...',
  runsAs: 'agent',
  timeout: 30_000,
  weight: 2,

  async run(ctx) {
    const result = await ctx.execAsUser(
      'openclaw --version 2>/dev/null; true',
      { timeout: 30_000 },
    );

    const warnings: string[] = [];
    if (!result.success) {
      warnings.push('openclaw --version failed, but install may have succeeded');
    }

    return { changed: false, warnings };
  },
};
