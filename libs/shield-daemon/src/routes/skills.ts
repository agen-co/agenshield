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
import {
  analyzeSkill,
  getCachedAnalysis,
  clearCachedAnalysis,
} from '../services/skill-analyzer';

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
   * GET /skills/:name - Get skill detail with analysis
   */
  app.get(
    '/skills/:name',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      // Return basic skill info with cached analysis
      const analysis = getCachedAnalysis(name);

      // Look up publisher from approved list
      const approved = listApproved();
      const entry = approved.find((s) => s.name === name);

      return reply.send({
        success: true,
        data: {
          name,
          analysis: analysis ?? null,
          publisher: entry?.publisher ?? null,
        },
      });
    }
  );

  /**
   * POST /skills/:name/analyze - Force re-analysis of a skill
   */
  app.post(
    '/skills/:name/analyze',
    async (
      request: FastifyRequest<{
        Params: { name: string };
        Body: { content?: string; metadata?: Record<string, unknown> };
      }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;
      const { content, metadata } = request.body ?? {};

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      // Clear existing cache
      clearCachedAnalysis(name);

      // Run analysis (content may come from the request body or we return pending)
      if (content) {
        const analysis = analyzeSkill(name, content, metadata);
        return reply.send({ success: true, data: { analysis } });
      }

      // No content provided - return pending status
      return reply.send({
        success: true,
        data: {
          analysis: {
            status: 'pending' as const,
            analyzerId: 'agenshield',
            commands: [],
          },
        },
      });
    }
  );

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
