/**
 * Enforce OpenClaw Config Step
 *
 * Reads openclaw.json, applies all matching config enforcements,
 * and writes the patched config back. Runs after config copy and
 * path rewriting so the enforcements are applied on the final config.
 *
 * Runs as a static pipeline step after detect/copy/rewrite.
 */

import type { InstallStep, PipelineState } from '../types.js';
import { resolveEnforcements, setDeep } from './config-enforcements.js';

export const enforceOpenclawConfigStep: InstallStep = {
  id: 'enforce_openclaw_config',
  name: 'Enforce managed config',
  description: 'Apply AgenShield-managed settings to openclaw.json',
  phase: 9,
  progressMessage: 'Applying managed config enforcements...',
  runsAs: 'root',
  timeout: 15_000,
  weight: 2,

  async run(ctx, state: PipelineState) {
    const configFile = `${ctx.agentHome}/.openclaw/openclaw.json`;

    // Read current config
    const readResult = await ctx.execAsRoot(
      `cat "${configFile}" 2>/dev/null || echo "__MISSING__"`,
      { timeout: 10_000 },
    );

    if (readResult.output?.includes('__MISSING__')) {
      return { changed: false, warnings: ['No openclaw.json found — skipping enforcements'] };
    }

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(readResult.output!);
    } catch {
      return { changed: false, warnings: ['Failed to parse openclaw.json — skipping enforcements'] };
    }

    // Resolve version from pipeline state or from config
    const version = state.outputs['install_openclaw.version']
      ?? ctx.requestedVersion
      ?? (config.version as string | undefined);

    // Apply enforcements
    const patches = resolveEnforcements(version);

    for (const patch of patches) {
      setDeep(config, patch.path, patch.value);
    }

    // Always enforce the workspace path to match the agent's home
    const workspacePath = 'agents.defaults.workspace';
    setDeep(config, workspacePath, `${ctx.agentHome}/.openclaw/workspace`);

    // Write back patched config
    const json = JSON.stringify(config, null, 2);
    await ctx.execAsRoot([
      `cat > "${configFile}" << 'ENFORCE_EOF'`,
      json,
      'ENFORCE_EOF',
      `chown ${ctx.agentUsername}:${ctx.socketGroupName} "${configFile}"`,
    ].join('\n'), { timeout: 10_000 });

    const titles = [...patches.map(p => p.path), workspacePath].join(', ');
    ctx.onLog?.(`Enforced config: ${titles}`);

    return { changed: true };
  },
};
