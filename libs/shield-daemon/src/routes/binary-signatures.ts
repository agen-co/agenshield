/**
 * Binary signatures API routes
 *
 * Manages SHA256 fingerprints of known binaries for anti-rename detection.
 */

import type { FastifyInstance } from 'fastify';
import { getStorage } from '@agenshield/storage';
import type { CreateSignatureInput } from '@agenshield/storage';

export async function binarySignatureRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /binary-signatures — List all binary signatures
   */
  app.get('/binary-signatures', async () => {
    const signatures = getStorage().binarySignatures.getAll();
    return { success: true, data: signatures };
  });

  /**
   * POST /binary-signatures/sync — Bulk upsert signatures (for cloud push or manual upload)
   */
  app.post('/binary-signatures/sync', async (request) => {
    const { signatures } = request.body as { signatures: CreateSignatureInput[] };
    const count = getStorage().binarySignatures.upsertBatch(signatures);
    return { success: true, data: { count } };
  });

  /**
   * DELETE /binary-signatures/:id — Remove a single signature
   */
  app.delete('/binary-signatures/:id', async (request) => {
    const { id } = request.params as { id: string };
    const deleted = getStorage().binarySignatures.delete(id);
    return { success: true, data: { deleted } };
  });
}
