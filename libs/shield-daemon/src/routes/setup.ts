/**
 * Setup routes
 *
 * Unified setup API consumed by both CLI and macOS app.
 *
 *   GET  /setup/status  — current setup + enrollment state
 *   POST /setup/local   — set up in local mode, returns admin token
 *   POST /setup/cloud   — start cloud enrollment (device code flow)
 */

import type { FastifyInstance } from 'fastify';
import type {
  ApiResponse,
  SetupStatusResponse,
  SetupCloudRequest,
  SetupCloudResponse,
  SetupLocalResponse,
  SetupEnrollmentState,
} from '@agenshield/ipc';
import { isCloudEnrolled, loadCloudCredentials } from '@agenshield/cloud';
import { getStorage } from '@agenshield/storage';
import { getSetupService } from '../services/setup';
import { getEnrollmentService, type EnrollmentState } from '../services/enrollment';

/**
 * Map internal EnrollmentState to the API-safe SetupEnrollmentState shape.
 */
function mapEnrollmentState(es: EnrollmentState): SetupEnrollmentState {
  const base: SetupEnrollmentState = { state: es.state };

  if (es.state === 'pending_user_auth') {
    base.verificationUri = es.verificationUri;
    base.userCode = es.userCode;
    base.expiresAt = es.expiresAt;
  } else if (es.state === 'complete') {
    base.agentId = es.agentId;
    base.companyName = es.companyName;
  } else if (es.state === 'failed') {
    base.error = es.error;
  }

  return base;
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /setup/status — combined setup + enrollment state
   */
  app.get('/setup/status', async (): Promise<ApiResponse<SetupStatusResponse>> => {
    const setupService = getSetupService();
    const enrollmentService = getEnrollmentService();

    const setup = setupService.getStatus();
    const enrollment = mapEnrollmentState(enrollmentService.getState());
    // Check file-based credentials first, then SQLite
    let cloudEnrolled = isCloudEnrolled();
    let claim: SetupStatusResponse['claim'];

    try {
      const storage = getStorage();
      const identity = storage.cloudIdentity.get();

      if (!cloudEnrolled && storage.cloudIdentity.isEnrolled()) {
        cloudEnrolled = true;
      }

      // Enrich with company name from credentials or SQLite
      if (cloudEnrolled && !enrollment.companyName) {
        const creds = loadCloudCredentials();
        if (creds?.companyName) {
          enrollment.companyName = creds.companyName;
        } else if (identity?.companyName) {
          enrollment.companyName = identity.companyName;
        }
      }

      // Build claim state from cloud identity
      if (identity) {
        claim = {
          status: identity.claimStatus,
          ...(identity.claimStatus === 'claimed' && identity.claimedUserId ? {
            user: {
              id: identity.claimedUserId,
              name: identity.claimedUserName ?? '',
              email: identity.claimedUserEmail ?? '',
            },
          } : {}),
        };
      }
    } catch { /* storage may not be ready */ }

    return {
      success: true,
      data: { setup, enrollment, cloudEnrolled, claim },
    };
  });

  /**
   * POST /setup/local — set up in local mode
   */
  app.post('/setup/local', async (): Promise<ApiResponse<SetupLocalResponse>> => {
    const setupService = getSetupService();
    const result = await setupService.setupLocal();

    return {
      success: true,
      data: { adminToken: result.adminToken },
    };
  });

  /**
   * POST /setup/cloud — start cloud enrollment
   *
   * Kicks off the device code flow. The caller should poll GET /setup/status
   * to track progress. Returns immediately with the initial enrollment state
   * (waits up to 15s for the enrollment to reach pending_user_auth).
   */
  app.post<{ Body: SetupCloudRequest }>(
    '/setup/cloud',
    async (request, reply): Promise<ApiResponse<SetupCloudResponse>> => {
      const { cloudUrl } = request.body as SetupCloudRequest;

      if (!cloudUrl || typeof cloudUrl !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'cloudUrl is required' },
        };
      }

      const setupService = getSetupService();
      const enrollmentService = getEnrollmentService();

      // Start enrollment asynchronously — don't await the full flow
      const enrollmentPromise = setupService.setupCloud(cloudUrl).catch((err) => {
        app.log.error({ err }, '[setup] Cloud enrollment initiation failed');
      });

      // Wait up to 15s for the state to advance past 'initiating'
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const state = enrollmentService.getState();
        if (state.state !== 'idle' && state.state !== 'initiating') {
          return {
            success: true,
            data: { enrollment: mapEnrollmentState(state) },
          };
        }
        await new Promise((r) => setTimeout(r, 300));
      }

      // If we timed out waiting, check once more and return whatever state we have
      // Also ensure the enrollment promise doesn't hang around uncaught
      void enrollmentPromise;
      const finalState = enrollmentService.getState();
      return {
        success: true,
        data: { enrollment: mapEnrollmentState(finalState) },
      };
    },
  );
}
