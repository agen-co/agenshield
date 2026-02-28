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
    // Extract basename for escaped-path replacement (e.g. 'ash_openclaw_agent')
    const agentBasename = ctx.agentHome.split('/').pop()!;

    await ctx.execAsRoot([
      `if [ -f "${agentConfigDir}/openclaw.json" ]; then`,
      // Pass 1: unescaped paths (e.g. /Users/david → /Users/ash_openclaw_agent)
      `  sed -i '' 's|/Users/${ctx.hostUsername}|${ctx.agentHome}|g' "${agentConfigDir}/openclaw.json"`,
      // Pass 2: escaped paths — OpenClaw's JSON serializer uses \/ (e.g. \/Users\/david → \/Users\/ash_openclaw_agent)
      `  sed -i '' 's|\\/Users\\/${ctx.hostUsername}|\\/Users\\/${agentBasename}|g' "${agentConfigDir}/openclaw.json"`,
      '  echo "PATHS_REWRITTEN"',
      'else',
      '  echo "NO_CONFIG_FILE"',
      'fi',
    ].join('\n'), { timeout: 15_000 });

    return { changed: true };
  },
};
