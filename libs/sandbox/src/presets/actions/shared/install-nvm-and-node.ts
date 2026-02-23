/**
 * Install NVM and Node.js Step (Factory)
 *
 * Installs NVM and a specific Node.js version. Idempotent — skips if
 * both NVM and the target Node.js version are already installed.
 */

import type { InstallStep } from '../types.js';
import { installNvmAndNode, nvmCommand } from '../../install-helpers.js';

export function createInstallNvmAndNodeStep(nodeVersion: string): InstallStep {
  return {
    id: 'install_nvm',
    name: `Install NVM & Node.js v${nodeVersion}`,
    description: `Install NVM and Node.js v${nodeVersion} in agent home (idempotent)`,
    phase: 7,
    progressMessage: `Installing NVM and Node.js v${nodeVersion}...`,
    runsAs: 'agent',
    timeout: 180_000,
    weight: 20,

    async check(ctx) {
      // Check NVM exists
      const nvmCheck = await ctx.execAsUser(
        `test -s "${ctx.agentHome}/.nvm/nvm.sh" && echo NVM_EXISTS || echo NVM_MISSING`,
        { timeout: 5_000 },
      );
      if (!nvmCheck.success || !nvmCheck.output.includes('NVM_EXISTS')) {
        return 'needed';
      }

      // Check target node version
      const nodeCheck = await ctx.execAsUser(
        nvmCommand(ctx.agentHome, `nvm ls ${nodeVersion} 2>/dev/null | grep -q "${nodeVersion}" && echo INSTALLED || echo MISSING`),
        { timeout: 15_000 },
      );
      return nodeCheck.success && nodeCheck.output.trim() === 'INSTALLED'
        ? 'satisfied'
        : 'needed';
    },

    async run(ctx) {
      await installNvmAndNode(ctx, nodeVersion);
      return { changed: true };
    },
  };
}
