/**
 * Open URL approval callback endpoint.
 *
 * Called by the macOS menubar app when the user taps Approve/Deny
 * on an open_url notification.
 */

import type { FastifyInstance } from 'fastify';
import { pendingUrlRequests } from './rpc';

export async function openUrlRespondRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { requestId: string; approved: boolean };
  }>('/open-url/respond', async (request, reply) => {
    const { requestId, approved } = request.body ?? {};

    if (!requestId || typeof approved !== 'boolean') {
      return reply.code(400).send({
        success: false,
        error: 'requestId (string) and approved (boolean) are required',
      });
    }

    const pending = pendingUrlRequests.get(requestId);
    if (!pending) {
      return reply.code(404).send({
        success: false,
        error: 'Request not found or expired',
      });
    }

    clearTimeout(pending.timer);
    pendingUrlRequests.delete(requestId);
    pending.resolve(approved);

    return { success: true };
  });
}
