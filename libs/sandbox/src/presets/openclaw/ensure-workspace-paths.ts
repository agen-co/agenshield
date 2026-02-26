/**
 * Ensure Workspace Paths Step
 *
 * Unconditionally rewrites any host-user paths in openclaw.json to the
 * agent home directory and ensures the workspace directory exists.
 *
 * This step runs after onboarding (both fresh and existing installs)
 * because `openclaw onboard` may generate config with the host user's
 * directory baked in.
 */

import type { InstallStep } from '../types.js';

export const ensureWorkspacePathsStep: InstallStep = {
  id: 'ensure_workspace_paths',
  name: 'Ensure workspace paths',
  description: 'Rewrite any host paths in openclaw.json and create agent workspace directory',
  phase: 8,
  progressMessage: 'Ensuring OpenClaw workspace paths...',
  runsAs: 'root',
  timeout: 15_000,
  weight: 2,

  async run(ctx) {
    const configFile = `${ctx.agentHome}/.openclaw/openclaw.json`;

    // Rewrite any host user paths → agent home (idempotent)
    await ctx.execAsRoot([
      `if [ -f "${configFile}" ]; then`,
      `  sed -i '' 's|/Users/${ctx.hostUsername}|${ctx.agentHome}|g' "${configFile}"`,
      '  echo "PATHS_CHECKED"',
      'else',
      '  echo "NO_CONFIG"',
      'fi',
    ].join('\n'), { timeout: 10_000 });

    // Ensure workspace directory exists with correct ownership
    await ctx.execAsRoot([
      `mkdir -p "${ctx.agentHome}/.openclaw/workspace"`,
      `chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${ctx.agentHome}/.openclaw"`,
    ].join(' && '), { timeout: 10_000 });

    return { changed: true };
  },
};
