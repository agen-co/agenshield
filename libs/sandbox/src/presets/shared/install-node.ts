/**
 * Install Node.js Step (Factory)
 *
 * Installs a specific Node.js version via NVM. Idempotent — skips if
 * the target version is already installed.
 */

import type { InstallStep } from '../types.js';
import { nvmCommand, checkedExecAsUserDirect } from './install-helpers.js';

export function createInstallNodeStep(nodeVersion = '24'): InstallStep {
  return {
    id: 'install_node',
    name: `Install Node.js v${nodeVersion}`,
    description: `Install Node.js v${nodeVersion} via NVM in agent home`,
    phase: 7,
    progressMessage: `Installing Node.js v${nodeVersion} via NVM...`,
    runsAs: 'agent',
    timeout: 120_000,
    weight: 12,

    async check(ctx) {
      const r = await ctx.execAsUser(
        nvmCommand(ctx.agentHome, `nvm ls ${nodeVersion} 2>/dev/null | grep -q "${nodeVersion}" && echo INSTALLED || echo MISSING`),
        { timeout: 15_000 },
      );
      return (r.output ?? '').includes('INSTALLED') ? 'satisfied' : 'needed';
    },

    async run(ctx) {
      ctx.onLog(`Installing Node.js v${nodeVersion} via NVM...`);
      const output = await checkedExecAsUserDirect(ctx,
        nvmCommand(ctx.agentHome, `nvm install ${nodeVersion} && nvm alias default ${nodeVersion} && node --version`),
        'node_install', 120_000,
      );
      ctx.onLog(`Node.js ${output.trim()} installed.`);
      return { changed: true, outputs: { nodeVersion: output.trim() } };
    },
  };
}
