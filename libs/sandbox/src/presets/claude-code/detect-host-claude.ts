/**
 * Detect Host Claude Step
 *
 * Checks if Claude Code is installed on the host user. Uses resolve() to
 * dynamically inject config copy steps when host Claude config is found.
 */

import type { InstallStep, PipelineState } from '../types.js';
import { copyClaudeConfigStep } from './copy-claude-config.js';
import { rewriteClaudePathsStep } from './rewrite-claude-paths.js';

export const detectHostClaudeStep: InstallStep = {
  id: 'detect_host_claude',
  name: 'Detect host Claude Code',
  description: 'Check if Claude Code is installed on the host user',
  phase: 9,
  progressMessage: 'Checking host for existing Claude Code installation...',
  runsAs: 'root',
  timeout: 15_000,
  weight: 2,

  skip(ctx) {
    return !!ctx.freshInstall;
  },

  async run(ctx, state: PipelineState) {
    const result = await ctx.execAsRoot(
      `test -d "/Users/${ctx.hostUsername}/.claude" && echo "FOUND" || echo "MISSING"`,
      { timeout: 10_000 },
    );
    const found = result.output?.includes('FOUND') ?? false;
    state.outputs['detect_host_claude.found'] = String(found);
    return { changed: false };
  },

  resolve(_ctx, state: PipelineState) {
    if (state.outputs['detect_host_claude.found'] !== 'true') return null;

    return [
      copyClaudeConfigStep,
      rewriteClaudePathsStep,
    ];
  },
};
