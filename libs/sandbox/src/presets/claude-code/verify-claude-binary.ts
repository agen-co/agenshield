/**
 * Verify Claude Binary Step
 *
 * Runs `claude --version` to verify the installation succeeded.
 */

import type { InstallStep } from '../types.js';
import { buildClaudeSearchPath } from './claude-paths.js';

export const verifyClaudeBinaryStep: InstallStep = {
  id: 'verify_claude',
  name: 'Verify Claude Code',
  description: 'Run claude --version to verify installation',
  phase: 8,
  progressMessage: 'Verifying Claude Code binary...',
  runsAs: 'agent',
  timeout: 15_000,
  weight: 5,

  async run(ctx) {
    const result = await ctx.execAsUser(
      `export HOME="${ctx.agentHome}" && export PATH="${buildClaudeSearchPath(ctx.agentHome)}:$PATH" && claude --version`,
      { timeout: 15_000 },
    );

    const warnings: string[] = [];
    const outputs: Record<string, string> = {};

    if (!result.success) {
      warnings.push('claude --version failed, but install may have succeeded');
    } else {
      const installedVersion = result.output.trim().split('\n')[0];
      if (installedVersion) {
        outputs['version'] = installedVersion;
      }
    }

    return { changed: false, outputs, warnings };
  },
};
