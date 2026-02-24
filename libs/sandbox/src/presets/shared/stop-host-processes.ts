/**
 * Stop Host Processes Step (Factory)
 *
 * Creates a step that stops host processes matching a kill pattern.
 * Used to stop host OpenClaw or Claude Code before config migration.
 *
 * @param appName - Application name for display (e.g., 'openclaw', 'claude')
 * @param killPattern - grep pattern for process matching (e.g., 'node.*openclaw', '[c]laude')
 */

import type { InstallStep } from '../types.js';

export function createStopHostProcessesStep(appName: string, killPattern: string): InstallStep {
  return {
    id: 'stop_host',
    name: `Stop host ${appName}`,
    description: `Stop host ${appName} processes before config migration`,
    phase: 8,
    progressMessage: `Stopping host ${appName} processes...`,
    runsAs: 'root',
    timeout: 30_000,
    weight: 3,

    async run(ctx) {
      if (appName === 'openclaw') {
        // Graceful stop + targeted PID kill as fallback
        await ctx.execAsRoot([
          `sudo -H -u ${ctx.hostUsername} openclaw gateway stop 2>/dev/null || true`,
          `sudo -H -u ${ctx.hostUsername} openclaw daemon stop 2>/dev/null || true`,
          `sleep 2; pkill -u $(id -u ${ctx.hostUsername}) -f '${killPattern}' 2>/dev/null; true`,
        ].join('; '), { timeout: 30_000 });
      } else {
        // Generic pattern-based kill
        await ctx.execAsRoot(
          `ps -u $(id -u ${ctx.hostUsername}) -o pid,command 2>/dev/null | grep -E '${killPattern}' | awk '{print $1}' | xargs kill 2>/dev/null; true`,
          { timeout: 15_000 },
        );
      }

      return { changed: true };
    },
  };
}
