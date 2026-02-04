/**
 * Skills Management Routes
 *
 * API endpoints for managing agent skills (approved and quarantined).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listApproved,
  listQuarantined,
  approveSkill,
  rejectSkill,
  revokeSkill,
} from '../watchers/skills';

/**
 * Register skills management routes
 */
export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /skills - List all skills (approved + quarantined)
   */
  app.get('/skills', async (_request: FastifyRequest, reply: FastifyReply) => {
    const approved = listApproved();
    const quarantined = listQuarantined();

    return reply.send({
      approved,
      quarantined,
      total: approved.length + quarantined.length,
    });
  });

  /**
   * GET /skills/quarantined - List quarantined skills
   */
  app.get('/skills/quarantined', async (_request: FastifyRequest, reply: FastifyReply) => {
    const quarantined = listQuarantined();
    return reply.send({ quarantined });
  });

  /**
   * POST /skills/:name/approve - Approve a quarantined skill
   */
  app.post(
    '/skills/:name/approve',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      const result = approveSkill(name);

      if (!result.success) {
        return reply.code(404).send({ error: result.error });
      }

      return reply.send({ success: true, message: `Skill "${name}" approved` });
    }
  );

  /**
   * DELETE /skills/:name - Reject and delete a quarantined skill
   */
  app.delete(
    '/skills/:name',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      const result = rejectSkill(name);

      if (!result.success) {
        return reply.code(404).send({ error: result.error });
      }

      return reply.send({ success: true, message: `Skill "${name}" rejected and deleted` });
    }
  );

  /**
   * POST /skills/:name/revoke - Revoke an approved skill
   */
  app.post(
    '/skills/:name/revoke',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      const result = revokeSkill(name);

      if (!result.success) {
        return reply.code(500).send({ error: result.error });
      }

      return reply.send({ success: true, message: `Skill "${name}" approval revoked` });
    }
  );
}
