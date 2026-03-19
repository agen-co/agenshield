/**
 * Launch Gate routes
 *
 * Provides a gate API for the Claude bootstrap wrapper to check
 * whether Claude Code is ready to launch. The wrapper calls this
 * before executing the shielded Claude binary.
 *
 * States:
 * - ready: Claude is shielded and claimed — exec the binary
 * - claim_required: device is registered but not claimed by a user
 * - claim_pending: claim session active, waiting for browser auth
 * - shield_in_progress: Claude is being shielded — show progress
 * - not_enrolled: device not registered with cloud
 * - not_shielded: Claude target not found — needs shielding
 */

import type { FastifyInstance } from 'fastify';
import { getStorage } from '@agenshield/storage';
import { getClaimService } from '../services/claim';

interface LaunchGateResponse {
  status: 'ready' | 'claim_required' | 'claim_pending' | 'shield_in_progress' | 'not_enrolled' | 'not_shielded' | 'failed';
  binary?: string;
  claimUrl?: string;
  claimSessionId?: string;
  progress?: number;
  message?: string;
}

export async function launchGateRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /launch-gate/claude — Check if Claude is ready to launch
   *
   * Called by the bootstrap wrapper at /usr/local/bin/claude.
   * Returns the current state and, when ready, the shielded binary path.
   */
  app.get<{ Reply: LaunchGateResponse }>('/launch-gate/claude', async (request): Promise<LaunchGateResponse> => {
    try {
      const storage = getStorage();

      // 1. Check cloud enrollment
      const identity = storage.cloudIdentity.get();
      if (!identity || !identity.agentId) {
        return {
          status: 'not_enrolled',
          message: 'Device not registered. Run: agenshield install --cloud-url <url> --token <token>',
        };
      }

      // 2. Check claim status
      if (identity.claimStatus === 'unclaimed') {
        return {
          status: 'claim_required',
          message: 'Login required for your organization.',
        };
      }

      if (identity.claimStatus === 'pending') {
        // Check if we have an active claim session
        const sessionId = storage.getMeta('claim.sessionId');
        const claimUrl = storage.getMeta('claim.url');
        return {
          status: 'claim_pending',
          claimSessionId: sessionId ?? undefined,
          claimUrl: claimUrl ?? undefined,
          message: 'Waiting for login approval. Complete login in your browser.',
        };
      }

      // 3. Check for active shielding operation (in-memory auto-shield state)
      try {
        const { getAutoShieldService } = await import('../services/auto-shield');
        const autoShieldState = getAutoShieldService().getState();
        if (autoShieldState.state === 'in_progress') {
          const pct = Math.round((autoShieldState.progress.current / autoShieldState.progress.total) * 100);
          return {
            status: 'shield_in_progress',
            progress: pct,
            message: `Shielding ${autoShieldState.progress.currentTarget ?? 'Claude Code'}...`,
          };
        }
      } catch { /* non-fatal */ }

      // 3b. Check for active shield operations (manual or auto) in the shield registry
      try {
        const { getActiveShieldOperations } = await import('../services/shield-registry');
        const activeOps = getActiveShieldOperations();
        const claudeOp = activeOps.find(op => op.targetId === 'claude-code');
        if (claudeOp) {
          return {
            status: 'shield_in_progress',
            progress: claudeOp.progress ?? 0,
            message: `Shielding Claude Code... ${claudeOp.currentStep ?? ''}`.trim(),
          };
        }
      } catch { /* non-fatal */ }

      // Also check storage meta for non-auto-shield operations
      const shieldingState = storage.getMeta('claude.shield.status');
      if (shieldingState === 'in_progress') {
        const progressStr = storage.getMeta('claude.shield.progress');
        return {
          status: 'shield_in_progress',
          progress: progressStr ? parseInt(progressStr, 10) : 0,
          message: 'Claude Code is being shielded...',
        };
      }

      // 4. Check shielding status
      const profiles = storage.profiles.getAll();
      const claudeProfile = profiles.find(
        (p: { presetId?: string }) => p.presetId === 'claude-code',
      );

      if (!claudeProfile) {
        // Check if auto-shield is already running or should be auto-triggered
        try {
          const { getAutoShieldService } = await import('../services/auto-shield');
          const autoShield = getAutoShieldService();
          const autoShieldState = autoShield.getState();

          if (autoShieldState.state === 'in_progress' || autoShieldState.state === 'pending') {
            const pct = autoShieldState.state === 'in_progress'
              ? Math.round((autoShieldState.progress.current / autoShieldState.progress.total) * 100)
              : 0;
            return {
              status: 'shield_in_progress',
              progress: pct,
              message: autoShieldState.state === 'in_progress'
                ? `Shielding ${autoShieldState.progress.currentTarget ?? 'Claude Code'}...`
                : 'Preparing to shield...',
            };
          }

          // Failed — report as not_shielded so the wrapper can prompt retry
          if (autoShieldState.state === 'failed') {
            return {
              status: 'not_shielded',
              message: autoShieldState.error ?? 'Shielding failed. Try again.',
            };
          }

          // Auto-shield is enabled but hasn't completed — report as in progress.
          // The actual run is triggered by claim completion or POST /shield,
          // not by this GET endpoint (keep GET side-effect free).
          if (autoShield.isEnabled() && !autoShield.isCompleted()) {
            return {
              status: 'shield_in_progress',
              progress: 0,
              message: 'Waiting for shielding to start...',
            };
          }
        } catch { /* non-fatal */ }

        // Not shielded and auto-shield not enabled — let the wrapper prompt the user
        return {
          status: 'not_shielded',
          message: 'Claude Code is not yet shielded.',
        };
      }

      // 5. Check shield schema version
      const currentSchemaVersion = storage.getMeta('claude.shield.schemaVersion');
      const requiredSchemaVersion = storage.getMeta('claude.shield.requiredSchemaVersion');
      if (requiredSchemaVersion && currentSchemaVersion !== requiredSchemaVersion) {
        return {
          status: 'not_shielded',
          message: 'Claude Code shielding needs to be updated.',
        };
      }

      // 6. Ready — find the shielded binary path
      const agentHome = (claudeProfile as { agentHomeDir?: string }).agentHomeDir;
      let binary: string | undefined;
      if (agentHome) {
        binary = `${agentHome}/bin/claude`;
      }

      return {
        status: 'ready',
        binary,
      };
    } catch (err) {
      request.log.error({ err }, 'Launch gate check failed');
      return {
        status: 'failed',
        message: (err as Error).message,
      };
    }
  });

  /**
   * POST /launch-gate/claude/shield — Trigger shielding
   *
   * Called by the wrapper after the user confirms they want to shield.
   * Starts auto-shield in the background and returns immediately.
   */
  app.post<{ Reply: LaunchGateResponse }>('/launch-gate/claude/shield', async (request): Promise<LaunchGateResponse> => {
    try {
      const { getAutoShieldService } = await import('../services/auto-shield');
      const autoShield = getAutoShieldService();
      const st = autoShield.getState().state;
      if (st !== 'in_progress' && st !== 'pending') {
        setImmediate(() => autoShield.run({ force: true }).catch(() => {}));
      }
      return {
        status: 'shield_in_progress',
        progress: 0,
        message: 'Shielding started...',
      };
    } catch (err) {
      request.log.error({ err }, 'Shield trigger failed');
      return { status: 'failed', message: (err as Error).message };
    }
  });

  /**
   * POST /launch-gate/claude/claim — Start or check a claim session
   *
   * Called by the wrapper or menu bar to initiate user login.
   * Creates a claim session with the cloud, returns the browser URL.
   */
  app.post<{ Reply: LaunchGateResponse }>('/launch-gate/claude/claim', async (request): Promise<LaunchGateResponse> => {
    try {
      const result = await getClaimService().startOrPollClaim();

      // Map claim service result to launch-gate response format
      switch (result.status) {
        case 'claimed':
          return { status: 'ready', message: 'Login approved!' };
        case 'pending':
          return {
            status: 'claim_pending',
            claimSessionId: result.claimSessionId,
            claimUrl: result.claimUrl,
            message: result.message ?? 'Waiting for login approval.',
          };
        case 'not_enrolled':
          return { status: 'not_enrolled', message: result.message ?? 'Device not registered.' };
        default:
          return { status: 'failed', message: result.message ?? 'Claim failed.' };
      }
    } catch (err) {
      request.log.error({ err }, 'Claim session failed');
      return { status: 'failed', message: (err as Error).message };
    }
  });
}
