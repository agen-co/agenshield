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
  createInstallNvmAndNodeStep,
  createRestoreShellConfigStep,
  copyNodeBinaryStep,
  patchNvmNodeStep,
  createStopHostProcessesStep,
} from '../shared/index.js';
import { cleanBrewLocksStep } from './clean-brew-locks.js';
import { installOpenclawStep } from './install-openclaw.js';
import { detectHostOpenclawStep } from './detect-host-openclaw.js';
import { verifyOpenclawStep } from './verify-openclaw.js';
import { writeGatewayPlistStep } from './write-gateway-plist.js';

export function getOpenclawPipeline(): InstallStep[] {
  return [
    // Phase 6: Homebrew
    saveHostShellConfigStep,                                    // weight 1
    installHomebrewStep,                                        // weight 15, check: brew exists?
    cleanBrewLocksStep,                                         // weight 1, best-effort

    // Phase 7: NVM & Node.js
    createInstallNvmAndNodeStep('24'),                          // weight 20, check: nvm + node v24?
    createRestoreShellConfigStep('nvm'),                        // weight 1
    copyNodeBinaryStep,                                         // weight 3

    // Phase 8: Target App
    installOpenclawStep,                                        // weight 25, 600s timeout
    createRestoreShellConfigStep('openclaw'),                   // weight 1
    detectHostOpenclawStep,                                     // weight 2, resolve() → injects copy steps
    createStopHostProcessesStep('openclaw', 'node.*openclaw'),  // weight 3

    // Phase 9: Configuration
    verifyOpenclawStep,                                         // weight 2
    patchNvmNodeStep,                                           // weight 5

    // Phase 12: Gateway
    writeGatewayPlistStep,                                      // weight 10
  ];
}
