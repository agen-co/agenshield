/**
 * Onboard OpenClaw Step
 *
 * Runs OpenClaw's non-interactive onboarding to create openclaw.json
 * when it doesn't already exist. This ensures a minimal working config
 * is present even when --no-onboard was used during install.
 */

import type { InstallStep } from '../types.js';
import { checkedExecAsUserDirect } from '../shared/install-helpers.js';

export const onboardOpenclawStep: InstallStep = {
  id: 'onboard_openclaw',
  name: 'Onboard OpenClaw',
  description: 'Run non-interactive onboarding to create openclaw.json',
  phase: 8,
  progressMessage: 'Running OpenClaw onboarding...',
  runsAs: 'agent',
  timeout: 120_000,
  weight: 5,

  async run(ctx) {
    // Idempotency check folded into a single IPC call — if openclaw.json
    // already exists, skip onboarding without a separate check() roundtrip.
    ctx.onLog('Running non-interactive OpenClaw onboarding...');

    const output = await checkedExecAsUserDirect(ctx, [
      `source "${ctx.agentHome}/.nvm/nvm.sh" &&`,
      `if [ -f "${ctx.agentHome}/.openclaw/openclaw.json" ]; then echo "ONBOARD_SKIP"; else`,
      'export BROWSER=none &&',
      'openclaw onboard --non-interactive --accept-risk --flow quickstart --mode local',
      '--no-install-daemon --daemon-runtime node --skip-channels --skip-skills',
      '--skip-health --skip-ui --node-manager npm; fi',
    ].join(' '), 'onboard_openclaw', 120_000);

    if (output.includes('ONBOARD_SKIP')) {
      ctx.onLog('OpenClaw already onboarded, skipping.');
      return { changed: false };
    }

    return { changed: true };
  },
};
