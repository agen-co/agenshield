/**
 * Copy Node Binary Step
 *
 * Copies the NVM node binary to per-target bin/node-bin and to the shared
 * host-level bin directory (for broker use).
 */

import type { InstallStep } from '../types.js';
import { copyNodeBinary } from './install-helpers.js';

export const copyNodeBinaryStep: InstallStep = {
  id: 'copy_node_binary',
  name: 'Copy node binary',
  description: 'Copy NVM node binary to agent bin and shared system bin',
  phase: 7,
  progressMessage: 'Copying Node.js binary for interceptor...',
  runsAs: 'mixed',
  timeout: 30_000,
  weight: 3,

  async run(ctx) {
    await copyNodeBinary(ctx);
    return { changed: true, outputs: { destPath: `${ctx.agentHome}/bin/node-bin` } };
  },
};
