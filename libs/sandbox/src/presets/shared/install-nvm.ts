/**
 * Install NVM Step (Factory)
 *
 * Installs NVM only. Idempotent — skips if nvm.sh already exists.
 */

import type { InstallStep } from '../types.js';
import { checkedExecAsUserDirect } from './install-helpers.js';
import { NVM_VERSION } from './versions.js';

export function createInstallNvmStep(): InstallStep {
  return {
    id: 'install_nvm',
    name: 'Install NVM',
    description: 'Install Node Version Manager in agent home',
    phase: 7,
    progressMessage: 'Installing Node Version Manager...',
    runsAs: 'agent',
    timeout: 60_000,
    weight: 8,

    async check(ctx) {
      const r = await ctx.execAsUser(
        `test -s "${ctx.agentHome}/.nvm/nvm.sh" && echo EXISTS || echo MISSING`,
        { timeout: 5_000 },
      );
      return (r.output ?? '').includes('EXISTS') ? 'satisfied' : 'needed';
    },

    async run(ctx) {
      ctx.onLog('Installing NVM...');
      await checkedExecAsUserDirect(ctx,
        `export PROFILE=/dev/null METHOD=script && curl -fsSL --retry 3 --retry-delay 2 https://raw.githubusercontent.com/nvm-sh/nvm/v${NVM_VERSION}/install.sh | bash`,
        'nvm_install', 60_000);
      return { changed: true };
    },
  };
}
