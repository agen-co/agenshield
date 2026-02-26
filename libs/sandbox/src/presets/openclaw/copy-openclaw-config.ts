/**
 * Copy OpenClaw Config Step
 *
 * Copies host OpenClaw config directory to agent home.
 * Dynamically injected by detectHostOpenclawStep when host config is found.
 */

import type { InstallStep } from '../types.js';

export const copyOpenclawConfigStep: InstallStep = {
  id: 'copy_config',
  name: 'Copy host OpenClaw config',
  description: 'Copy host .openclaw directory to agent home',
  phase: 9,
  progressMessage: 'Copying host OpenClaw configuration...',
  runsAs: 'root',
  timeout: 30_000,
  weight: 5,

  async run(ctx) {
    const hostConfigDir = `/Users/${ctx.hostUsername}/.openclaw`;
    const agentConfigDir = `${ctx.agentHome}/.openclaw`;

    const copyResult = await ctx.execAsRoot([
      `if [ -d "${hostConfigDir}" ]; then`,
      `  mkdir -p "${agentConfigDir}"`,
      `  rsync -a --delete "${hostConfigDir}/" "${agentConfigDir}/"`,
      `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${agentConfigDir}"`,
      '  echo "CONFIG_COPIED"',
      'else',
      '  echo "NO_HOST_CONFIG"',
      'fi',
    ].join('\n'), { timeout: 30_000 });

    if (copyResult.output?.includes('NO_HOST_CONFIG')) {
      return {
        changed: false,
        warnings: ['No host OpenClaw config found — agent will use defaults'],
      };
    }

    return { changed: true };
  },
};
