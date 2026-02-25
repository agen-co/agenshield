/**
 * Install Claude Code Step
 *
 * Installs Claude Code via the official curl|bash installer.
 * Uses direct shell (no guarded shell) so system curl is available.
 */

import type { InstallStep } from '../types.js';
import { checkedExecAsUserDirect } from '../shared/install-helpers.js';
import { TargetAppInstallError } from '../../errors.js';

export const installClaudeCodeStep: InstallStep = {
  id: 'install_claude',
  name: 'Install Claude Code',
  description: 'Install Claude Code via official installer',
  phase: 8,
  progressMessage: 'Installing Claude Code...',
  runsAs: 'agent',
  timeout: 300_000,
  weight: 30,

  async check(ctx) {
    if (ctx.freshInstall) return 'needed';

    const result = await ctx.execAsUser(
      `export HOME="${ctx.agentHome}" && export PATH="${ctx.agentHome}/.claude/local/bin:$PATH" && command -v claude && claude --version 2>/dev/null`,
      { timeout: 15_000 },
    );
    const output = result.output ?? '';
    if (output.includes('claude') && /\d+\.\d+/.test(output)) {
      const requestedVersion = ctx.requestedVersion;
      if (!requestedVersion || requestedVersion === 'latest' || output.includes(requestedVersion)) {
        ctx.onLog(`Claude Code already installed: ${output.trim()}`);
        return 'satisfied';
      }
    }
    return 'needed';
  },

  async run(ctx) {
    const version = ctx.requestedVersion ?? ctx.detection?.version ?? 'latest';

    try {
      await checkedExecAsUserDirect(ctx,
        `export HOME="${ctx.agentHome}" && export BROWSER=none && curl -fsSL https://claude.ai/install.sh | bash`,
        'install_claude', 300_000);
    } catch (err) {
      throw new TargetAppInstallError((err as Error).message, 'claude-code');
    }

    return {
      changed: true,
      outputs: { version },
    };
  },
};
