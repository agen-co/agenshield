/**
 * Rewrite OpenClaw Paths Step
 *
 * Rewrites host user paths in the copied openclaw.json to point to the
 * agent home directory. Dynamically injected by detectHostOpenclawStep.
 */

import type { InstallStep } from '../types.js';

export const rewriteOpenclawPathsStep: InstallStep = {
  id: 'rewrite_config_paths',
  name: 'Rewrite config paths',
  description: 'Adjust workspace paths in openclaw.json to use agent home',
  phase: 9,
  progressMessage: 'Adjusting workspace paths in openclaw.json...',
  runsAs: 'root',
  timeout: 15_000,
  weight: 2,

  async run(ctx) {
    const agentConfigDir = `${ctx.agentHome}/.openclaw`;

    await ctx.execAsRoot([
      `if [ -f "${agentConfigDir}/openclaw.json" ]; then`,
      `  sed -i '' 's|/Users/${ctx.hostUsername}|${ctx.agentHome}|g' "${agentConfigDir}/openclaw.json"`,
      '  echo "PATHS_REWRITTEN"',
      'else',
      '  echo "NO_CONFIG_FILE"',
      'fi',
    ].join('\n'), { timeout: 15_000 });

    return { changed: true };
  },
};
