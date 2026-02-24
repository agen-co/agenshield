/**
 * Install Claude Code Step
 *
 * Installs Claude Code via the official curl|bash installer.
 */

import type { InstallStep } from '../types.js';
import { checkedExecAsUser } from '../shared/install-helpers.js';
import { TargetAppInstallError } from '../../errors.js';

export const installClaudeCodeStep: InstallStep = {
  id: 'install_claude',
  name: 'Install Claude Code',
  description: 'Install Claude Code via official installer',
  phase: 8,
  progressMessage: 'Installing Claude Code...',
  runsAs: 'agent',
  timeout: 180_000,
  weight: 30,

  async run(ctx) {
    try {
      await checkedExecAsUser(ctx,
        'curl -fsSL https://claude.ai/install.sh | bash',
        'install_claude', 180_000);
    } catch (err) {
      throw new TargetAppInstallError((err as Error).message, 'claude-code');
    }

    return { changed: true };
  },
};
