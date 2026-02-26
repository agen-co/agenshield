/**
 * OpenClaw Pipeline
 *
 * Defines the ordered step array for OpenClaw installation.
 * Single source of truth for execution order.
 */

import type { InstallStep } from '../types.js';
import {
  saveHostShellConfigStep,
  installHomebrewStep,
  createInstallNvmStep,
  createInstallNodeStep,
  createRestoreShellConfigStep,
  copyNodeBinaryStep,
  patchNvmNodeStep,
  createStopHostProcessesStep,
  createAppWrapperStep,
} from '../shared/index.js';
import { cleanBrewLocksStep } from './clean-brew-locks.js';
import { installOpenclawStep } from './install-openclaw.js';
import { onboardOpenclawStep } from './onboard-openclaw.js';
import { detectHostOpenclawStep } from './detect-host-openclaw.js';
import { verifyOpenclawStep } from './verify-openclaw.js';
import { writeGatewayPlistStep } from './write-gateway-plist.js';
import { injectSkillsStep } from './inject-skills.js';

export function getOpenclawPipeline(): InstallStep[] {
  return [
    // Phase 6: Homebrew
    saveHostShellConfigStep,                                    // weight 1
    installHomebrewStep,                                        // weight 15, check: brew exists?
    cleanBrewLocksStep,                                         // weight 1, best-effort

    // Phase 7: NVM & Node.js
    createInstallNvmStep(),                                     // weight 8, check: nvm exists?
    createInstallNodeStep('24'),                                // weight 12, check: node v24?
    createRestoreShellConfigStep('nvm'),                        // weight 1
    copyNodeBinaryStep,                                         // weight 3

    // Phase 8: Target App
    installOpenclawStep,                                        // weight 25, 600s timeout, check: binary exists?
    onboardOpenclawStep,                                        // weight 5, creates openclaw.json if missing
    createRestoreShellConfigStep('openclaw'),                   // weight 1
    detectHostOpenclawStep,                                     // weight 2, resolve() → injects copy steps
    createStopHostProcessesStep('openclaw', 'node.*openclaw'),  // weight 3

    // Phase 9: Configuration
    verifyOpenclawStep,                                         // weight 2
    createAppWrapperStep('openclaw', async (ctx) => {           // weight 2
      const { checkedExecAsUser } = await import('../shared/install-helpers.js');
      return (await checkedExecAsUser(ctx, 'which openclaw', 'resolve_openclaw', 10_000)).trim();
    }),
    patchNvmNodeStep,                                           // weight 5

    // Phase 10: Skills
    injectSkillsStep,                                           // weight 3

    // Phase 12: Gateway
    writeGatewayPlistStep,                                      // weight 10
  ];
}
