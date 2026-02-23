/**
 * Save Host Shell Config Step
 *
 * Snapshots the host user's .zshrc and .bashrc so they can be restored
 * if external installers (NVM, OpenClaw curl|bash) modify them.
 */

import type { InstallStep, PipelineState } from '../types.js';
import { saveHostShellConfig } from '../../install-helpers.js';

export const saveHostShellConfigStep: InstallStep = {
  id: 'save_host_shell_config',
  name: 'Save host shell config',
  description: 'Snapshot .zshrc/.bashrc before external installers run',
  phase: 6,
  progressMessage: 'Saving host shell configuration...',
  runsAs: 'root',
  timeout: 15_000,
  weight: 1,

  async run(ctx, state: PipelineState) {
    const backups = await saveHostShellConfig(ctx);
    state.shellBackups = backups;
    return {
      changed: false,
      outputs: { backupCount: String(backups.length) },
    };
  },
};
