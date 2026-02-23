/**
 * Detect Host OpenClaw Step
 *
 * Checks if OpenClaw is installed on the host user. Uses resolve() to
 * dynamically inject config copy steps when host OpenClaw config is found.
 */

import type { InstallStep, PipelineState } from '../types.js';
import { copyOpenclawConfigStep } from './copy-openclaw-config.js';
import { rewriteOpenclawPathsStep } from './rewrite-openclaw-paths.js';

export const detectHostOpenclawStep: InstallStep = {
  id: 'detect_host_openclaw',
  name: 'Detect host OpenClaw',
  description: 'Check if OpenClaw is installed on the host user',
  phase: 8,
  progressMessage: 'Checking host for existing OpenClaw installation...',
  runsAs: 'root',
  timeout: 15_000,
  weight: 2,

  skip(ctx) {
    // On fresh installs, no need to detect host config
    return !!ctx.freshInstall;
  },

  async run(ctx, state: PipelineState) {
    const result = await ctx.execAsRoot(
      `test -d "/Users/${ctx.hostUsername}/.openclaw" && echo "FOUND" || echo "MISSING"`,
      { timeout: 10_000 },
    );
    const found = result.output?.includes('FOUND') ?? false;
    state.outputs['detect_host_openclaw.found'] = String(found);
    return { changed: false };
  },

  resolve(_ctx, state: PipelineState) {
    if (state.outputs['detect_host_openclaw.found'] !== 'true') return null;

    return [
      copyOpenclawConfigStep,
      rewriteOpenclawPathsStep,
    ];
  },
};
