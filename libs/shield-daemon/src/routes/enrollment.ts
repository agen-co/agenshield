/**
 * Enrollment route
 *
 * Exposes the current enrollment state so the UI/CLI can show
 * the device code and verification URL to the user.
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { createAgentSigHeader } from '@agenshield/cloud';
import { getEnrollmentService, type EnrollmentState } from '../services/enrollment';

export async function enrollmentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/enrollment/status', async (): Promise<ApiResponse<EnrollmentState>> => {
    const state = getEnrollmentService().getState();
    return {
      success: true,
      data: state,
    };
  });

  /**
   * POST /enrollment/register — Save cloud identity after device registration.
   *
   * Called by the CLI install command after registering with the cloud.
   * The daemon has the DB open as root, so the CLI delegates storage to here.
   */
  app.post<{
    Body: {
      agentId: string;
      publicKey: string;
      privateKey: string;
      cloudUrl: string;
      companyId?: string;
      companyName?: string;
    };
  }>('/enrollment/register', async (request): Promise<ApiResponse<{ agentId: string }>> => {
    try {
      const { agentId, publicKey, privateKey, cloudUrl, companyId, companyName } = request.body;

      if (!agentId || !publicKey || !privateKey || !cloudUrl) {
        return {
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'Missing required fields: agentId, publicKey, privateKey, cloudUrl' },
        };
      }

      const storage = getStorage();

      // One-time only — reject if already enrolled
      if (storage.cloudIdentity.isEnrolled()) {
        return {
          success: false,
          error: { code: 'ALREADY_ENROLLED', message: 'Device is already enrolled. Unenroll first to re-register.' },
        };
      }

      storage.cloudIdentity.save({
        agentId,
        publicKey,
        privateKey,
        cloudUrl,
        companyId,
        companyName,
      });

      // Write setup meta
      storage.setMeta('setup.mode', 'cloud');
      storage.setMeta('setup.cloudUrl', cloudUrl);
      storage.setMeta('setup.completedAt', new Date().toISOString());

      request.log.info(`[enrollment] Device registered: ${agentId}`);

      // Trigger cloud connection + service activation in the background.
      // The HTTP response returns immediately; cloud handshake runs async.
      setImmediate(async () => {
        try {
          const { getCloudConnector } = await import('../services/cloud-connector');
          const { getActivationService } = await import('../services/activation');
          const { emitDaemonStatus } = await import('../events/emitter');
          const { buildDaemonStatus } = await import('./status');

          const cloud = getCloudConnector();
          await cloud.connect();
          request.log.info('[enrollment] Cloud connection established after enrollment');

          const activation = getActivationService();
          if (!activation.isActive()) {
            await activation.activate();
            request.log.info('[enrollment] Monitoring services activated after enrollment');
          }

          emitDaemonStatus(buildDaemonStatus());

          // Trigger auto-shield immediately so shielding starts at enrollment,
          // not when the user first runs `claude`
          try {
            const { getAutoShieldService } = await import('../services/auto-shield');
            const autoShield = getAutoShieldService();
            if (autoShield.getState().state === 'idle') {
              request.log.info('[enrollment] Triggering auto-shield after enrollment');
              await autoShield.run({ force: true });
              request.log.info('[enrollment] Auto-shield completed after enrollment');
            }
          } catch (shieldErr) {
            request.log.warn({ err: shieldErr }, '[enrollment] Auto-shield after enrollment failed (non-fatal)');
          }
        } catch (err) {
          request.log.warn({ err }, '[enrollment] Post-enrollment cloud connection failed (non-fatal)');
        }
      });

      return {
        success: true,
        data: { agentId },
      };
    } catch (err) {
      request.log.error({ err }, '[enrollment] Registration failed');
      return {
        success: false,
        error: { code: 'ENROLLMENT_FAILED', message: (err as Error).message },
      };
    }
  });

  /**
   * POST /enrollment/unenroll — Deregister from cloud and clear local identity.
   *
   * Called by the CLI uninstall command before stopping the daemon.
   * Best-effort: cloud deregistration failure does not block local cleanup.
   */
  app.post('/enrollment/unenroll', async (request): Promise<ApiResponse<{ success: boolean }>> => {
    try {
      const storage = getStorage();
      const identity = storage.cloudIdentity.get();

      // Best-effort cloud deregistration
      if (identity?.agentId && identity.privateKey && identity.cloudUrl) {
        try {
          const authHeader = createAgentSigHeader(identity.agentId, identity.privateKey);
          await fetch(`${identity.cloudUrl}/api/agents/${identity.agentId}/deregister`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader },
            signal: AbortSignal.timeout(10_000),
          });
          request.log.info('[enrollment] Cloud deregistration successful');
        } catch (err) {
          request.log.warn({ err }, '[enrollment] Cloud deregistration failed (best-effort)');
        }
      }

      // Disconnect cloud WebSocket
      try {
        const { getCloudConnector } = await import('../services/cloud-connector');
        getCloudConnector().disconnect();
      } catch { /* non-fatal */ }

      // Clear local identity and claim state
      storage.cloudIdentity.delete();
      storage.deleteMeta('claim.sessionId');
      storage.deleteMeta('claim.url');

      request.log.info('[enrollment] Local unenrollment complete');

      return { success: true, data: { success: true } };
    } catch (err) {
      request.log.error({ err }, '[enrollment] Unenroll failed');
      return {
        success: false,
        error: { code: 'UNENROLL_FAILED', message: (err as Error).message },
      };
    }
  });
}
