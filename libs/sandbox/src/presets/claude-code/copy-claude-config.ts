/**
 * Copy Claude Config Step
 *
 * Copies host Claude Code config directory to agent home, excluding
 * `local` (binaries) and `downloads` subdirectories.
 * Dynamically injected by detectHostClaudeStep when host config is found.
 */

import type { InstallStep } from '../types.js';

export const copyClaudeConfigStep: InstallStep = {
  id: 'copy_claude_config',
  name: 'Copy host Claude config',
  description: 'Copy host .claude directory to agent home',
  phase: 9,
  progressMessage: 'Copying host Claude Code configuration...',
  runsAs: 'root',
  timeout: 30_000,
  weight: 5,

  async run(ctx) {
    const hostConfigDir = `/Users/${ctx.hostUsername}/.claude`;
    const agentConfigDir = `${ctx.agentHome}/.claude`;

    const copyResult = await ctx.execAsRoot([
      `if [ -d "${hostConfigDir}" ]; then`,
      `  mkdir -p "${agentConfigDir}"`,
      `  rsync -a --exclude="local" --exclude="downloads" "${hostConfigDir}/" "${agentConfigDir}/"`,
      `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${agentConfigDir}"`,
      '  echo "CONFIG_COPIED"',
      'else',
      '  echo "NO_HOST_CONFIG"',
      'fi',
    ].join('\n'), { timeout: 30_000 });

    if (copyResult.output?.includes('NO_HOST_CONFIG')) {
      return {
        changed: false,
        warnings: ['No host Claude config found — agent will use defaults'],
      };
    }

    return { changed: true };
  },
};
