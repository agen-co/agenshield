/**
 * Restore Host Shell Config Step (Factory)
 *
 * Creates a step that restores host shell config files if they were modified
 * by external installers. Uses the backups stored in PipelineState by
 * saveHostShellConfigStep.
 *
 * @param afterStepLabel - Descriptive label for what triggered the check (e.g., 'nvm', 'openclaw')
 */

import type { InstallStep, PipelineState } from '../types.js';
import { restoreHostShellConfig } from './install-helpers.js';

export function createRestoreShellConfigStep(afterStepLabel: string): InstallStep {
  return {
    id: `restore_shell_config_${afterStepLabel}`,
    name: `Restore shell config (after ${afterStepLabel})`,
    description: `Check and restore host shell configs if modified by ${afterStepLabel} installer`,
    phase: 7,
    progressMessage: `Checking host shell config after ${afterStepLabel}...`,
    runsAs: 'root',
    timeout: 15_000,
    weight: 1,

    skip(_ctx, state: PipelineState) {
      // Nothing to restore if no backups were saved
      return !state.shellBackups || state.shellBackups.length === 0;
    },

    async run(ctx, state: PipelineState) {
      await restoreHostShellConfig(ctx, state.shellBackups ?? []);
      return { changed: false };
    },
  };
}
