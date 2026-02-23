/**
 * Clean Brew Locks Step
 *
 * Best-effort cleanup of stale Homebrew locks from previous failed attempts.
 * Kills lingering brew processes and removes lock files.
 */

import type { InstallStep } from '../types.js';

export const cleanBrewLocksStep: InstallStep = {
  id: 'clean_brew_locks',
  name: 'Clean brew locks',
  description: 'Remove stale Homebrew locks from previous failed attempts',
  phase: 6,
  progressMessage: 'Cleaning stale Homebrew locks...',
  runsAs: 'root',
  timeout: 10_000,
  weight: 1,

  async run(ctx) {
    await ctx.execAsRoot(
      `pkill -u $(id -u ${ctx.agentUsername}) -f 'brew' 2>/dev/null; rm -rf "${ctx.agentHome}/homebrew/var/homebrew/locks" 2>/dev/null; true`,
      { timeout: 10_000 },
    );
    return { changed: true };
  },
};
