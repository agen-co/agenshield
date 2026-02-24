/**
 * Patch NVM Node Step
 *
 * Backs up the real NVM node binary and writes an interceptor wrapper
 * in its place. The wrapper injects NODE_OPTIONS with the interceptor
 * register script.
 */

import type { InstallStep, PipelineState } from '../types.js';
import { patchNvmNode } from './install-helpers.js';

export const patchNvmNodeStep: InstallStep = {
  id: 'patch_node',
  name: 'Patch NVM node',
  description: 'Wrap NVM node binary with interceptor',
  phase: 9,
  progressMessage: 'Patching NVM node with interceptor wrapper...',
  runsAs: 'mixed',
  timeout: 30_000,
  weight: 5,

  async run(ctx, _state: PipelineState) {
    await patchNvmNode(ctx);
    // The node binary path is under NVM — we can't know the exact path without
    // running `which node`, but the rollback handler can look for the .real backup
    // relative to the NVM dir. Store agentHome so rollback can find it.
    return { changed: true, outputs: { agentHome: ctx.agentHome } };
  },
};
