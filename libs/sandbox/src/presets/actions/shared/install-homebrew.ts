/**
 * Install Homebrew Step
 *
 * Downloads and installs Homebrew in agent home. Idempotent — skips if brew
 * binary already exists.
 */

import type { InstallStep } from '../types.js';
import { installHomebrew } from '../../install-helpers.js';

export const installHomebrewStep: InstallStep = {
  id: 'install_homebrew',
  name: 'Install Homebrew',
  description: 'Download and install Homebrew in agent home (idempotent)',
  phase: 6,
  progressMessage: 'Installing Homebrew in agent environment...',
  runsAs: 'mixed',
  timeout: 150_000,
  weight: 15,

  async check(ctx) {
    const result = await ctx.execAsRoot(
      `test -x "${ctx.agentHome}/homebrew/bin/brew" && echo "EXISTS" || echo "MISSING"`,
      { timeout: 5_000 },
    );
    return result.output?.includes('EXISTS') ? 'satisfied' : 'needed';
  },

  async run(ctx) {
    await installHomebrew(ctx);
    return { changed: true };
  },
};
