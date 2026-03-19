/**
 * Cloud Claim route — POST /api/cloud/claim
 *
 * Idempotent route for the menu bar (and other clients) to start or poll
 * a user claim session. Returns current claim status + URL for browser auth.
 */

import type { FastifyInstance } from 'fastify';
import { getClaimService, type ClaimResult } from '../services/claim';
import { emitDaemonStatus } from '../events/emitter';
import { buildDaemonStatus } from './status';

export async function cloudClaimRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /cloud/claim — Start or poll a user claim session
   *
   * Returns:
   * - { status: 'unclaimed' } → no session yet (shouldn't happen — we create one)
   * - { status: 'pending', claimUrl } → session created, open URL in browser
   * - { status: 'claimed', user: { id, name, email } } → user linked
   * - { status: 'not_enrolled', message } → device not registered
   * - { status: 'failed', message } → error
   */
  app.post<{ Reply: ClaimResult }>('/cloud/claim', async (_request): Promise<ClaimResult> => {
    const result = await getClaimService().startOrPollClaim();

    // Broadcast status update when claim state changes
    if (result.status === 'claimed' || result.status === 'pending') {
      emitDaemonStatus(buildDaemonStatus());
    }

    return result;
  });

  /**
   * GET /cloud/claim — Get current claim status without starting a session
   */
  app.get<{ Reply: ClaimResult }>('/cloud/claim', async (): Promise<ClaimResult> => {
    return getClaimService().getClaim();
  });
}
