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

    // Resolve and hash the claude binary for integrity tracking
    try {
      const whichResult = await ctx.execAsUser(
        `export HOME="${ctx.agentHome}" && export PATH="${buildClaudeSearchPath(ctx.agentHome)}:$PATH" && which claude`,
        { timeout: 5_000 },
      );
      const claudePath = (whichResult.output ?? '').trim();
      if (claudePath) {
        outputs['claudeBinaryPath'] = claudePath;
        // Resolve the real path (may be a symlink)
        const realResult = await ctx.execAsUser(
          `readlink -f "${claudePath}" 2>/dev/null || echo "${claudePath}"`,
          { timeout: 5_000 },
        );
        const realPath = (realResult.output ?? '').trim();
        if (realPath) {
          const hashResult = await ctx.execAsUser(
            `shasum -a 256 "${realPath}" 2>/dev/null | awk '{print $1}'`,
            { timeout: 10_000 },
          );
          const hash = (hashResult.output ?? '').trim();
          if (hash) {
            outputs['claudeBinaryHash'] = hash;
            outputs['claudeRealPath'] = realPath;
          }
        }
      }
    } catch {
      // Non-fatal — hash is optional
    }

    return { changed: false, outputs, warnings };
  },
};
