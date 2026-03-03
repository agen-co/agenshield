/**
 * Validate Guarded Shell Step
 *
 * Post-install validation that runs `claude --version` through the guarded shell
 * (execAsUser) to confirm the restricted sandbox environment works correctly.
 * This catches issues like missing PATH entries, blocked setopt, etc.
 */

import type { InstallStep } from '../types.js';

export const validateGuardedShellStep: InstallStep = {
  id: 'validate_guarded_shell',
  name: 'Validate guarded shell',
  description: 'Verify claude runs correctly in the restricted sandbox environment',
  phase: 10,
  progressMessage: 'Validating sandbox environment...',
  runsAs: 'agent',
  timeout: 15_000,
  weight: 2,

  async run(ctx) {
    // This runs through the guarded shell (execAsUser) to confirm
    // the sandbox is properly configured and claude is accessible
    const result = await ctx.execAsUser('claude --version', { timeout: 10_000 });

    if (!result.success) {
      // Non-fatal warning — install succeeded but sandbox validation failed
      return {
        changed: false,
        warnings: [`Guarded shell validation: claude --version failed: ${result.error || result.output}`],
      };
    }

    return {
      changed: false,
      outputs: { guardedShellVersion: result.output.trim() },
    };
  },
};
