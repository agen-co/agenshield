/**
 * Install OpenClaw Step
 *
 * Installs OpenClaw via the official curl|bash installer.
 * Supports version pinning and fresh install mode.
 */

import type { InstallStep } from '../types.js';
import { checkedExecAsUser, nvmCommand } from '../../install-helpers.js';
import { TargetAppInstallError } from '../../../errors.js';

export const installOpenclawStep: InstallStep = {
  id: 'install_openclaw',
  name: 'Install OpenClaw',
  description: 'Install OpenClaw via official installer',
  phase: 8,
  progressMessage: 'Installing OpenClaw via official installer...',
  runsAs: 'agent',
  timeout: 600_000,
  weight: 25,

  async run(ctx) {
    const version = ctx.requestedVersion ?? ctx.detection?.version ?? 'latest';
    const onboardFlag = ctx.freshInstall ? '' : ' --no-onboard';
    const versionFlag = version && version !== 'latest' ? ` --version ${version}` : '';

    try {
      await checkedExecAsUser(ctx,
        nvmCommand(ctx.agentHome, `export BROWSER=none && curl -fsSL https://openclaw.ai/install.sh | bash -s --${onboardFlag} --no-prompt${versionFlag}`),
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
