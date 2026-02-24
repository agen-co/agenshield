/**
 * Install OpenClaw Step
 *
 * Installs OpenClaw via the official curl|bash installer.
 * Supports version pinning and fresh install mode.
 */

import type { InstallStep } from '../types.js';
import { checkedExecAsUserDirect } from '../shared/install-helpers.js';
import { TargetAppInstallError } from '../../errors.js';

export const installOpenclawStep: InstallStep = {
  id: 'install_openclaw',
  name: 'Install OpenClaw',
  description: 'Install OpenClaw via official installer',
  phase: 8,
  progressMessage: 'Installing OpenClaw via official installer...',
  runsAs: 'agent',
  timeout: 600_000,
  weight: 25,

  async check(ctx) {
    // Skip expensive version check on fresh installs — always needed
    if (ctx.freshInstall) return 'needed';

    // Check if openclaw binary exists and is callable under agent NVM (fast path)
    const result = await ctx.execAsUser(
      'command -v openclaw && openclaw --version 2>/dev/null',
      { timeout: 15_000 },
    );
    const output = result.output ?? '';
    if (output.includes('openclaw') && /\d+\.\d+/.test(output)) {
      const requestedVersion = ctx.requestedVersion;
      if (!requestedVersion || requestedVersion === 'latest' || output.includes(requestedVersion)) {
        ctx.onLog(`OpenClaw already installed: ${output.trim()}`);
        return 'satisfied';
      }
    }
    return 'needed';
  },

  async run(ctx) {
    const version = ctx.requestedVersion ?? ctx.detection?.version ?? 'latest';
    // Always skip built-in onboarding — dedicated onboardOpenclawStep handles it
    const onboardFlag = ' --no-onboard';
    const versionFlag = version && version !== 'latest' ? ` --version ${version}` : '';

    try {
      await checkedExecAsUserDirect(ctx,
        `source "${ctx.agentHome}/.nvm/nvm.sh" && export BROWSER=none && curl -fsSL https://openclaw.ai/install.sh | bash -s --${onboardFlag} --no-prompt${versionFlag}`,
        'install_openclaw', 600_000,
      );
    } catch (err) {
      throw new TargetAppInstallError((err as Error).message, 'openclaw');
    }

    return {
      changed: true,
      outputs: { version },
    };
  },
};
