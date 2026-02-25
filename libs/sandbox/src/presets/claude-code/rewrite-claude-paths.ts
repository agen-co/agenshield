/**
 * Rewrite Claude Paths Step
 *
 * Rewrites host user paths in copied Claude config JSON files to point
 * to the agent home directory. Dynamically injected by detectHostClaudeStep.
 */

import type { InstallStep } from '../types.js';

export const rewriteClaudePathsStep: InstallStep = {
  id: 'rewrite_claude_paths',
  name: 'Rewrite Claude config paths',
  description: 'Adjust paths in Claude JSON config files to use agent home',
  phase: 9,
  progressMessage: 'Adjusting paths in Claude config files...',
  runsAs: 'root',
  timeout: 15_000,
  weight: 2,

  async run(ctx) {
    const agentConfigDir = `${ctx.agentHome}/.claude`;

    await ctx.execAsRoot([
      `find "${agentConfigDir}" -name "*.json" -exec sed -i '' 's|/Users/${ctx.hostUsername}|${ctx.agentHome}|g' {} + 2>/dev/null || true`,
    ].join('\n'), { timeout: 15_000 });

    return { changed: true };
  },
};
