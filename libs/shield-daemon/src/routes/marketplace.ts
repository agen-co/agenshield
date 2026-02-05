/**
 * Marketplace Routes
 *
 * Proxy endpoints for ClawHub marketplace search/detail,
 * agen.co vulnerability analysis, and local skill installation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  MarketplaceSkillFile,
  InstallSkillRequest,
  AnalyzeSkillResponse,
} from '@agenshield/ipc';
import {
  searchMarketplace,
  getMarketplaceSkill,
  analyzeSkillBundle,
  getCachedAnalysis,
} from '../services/marketplace';
import { analyzeSkill } from '../services/skill-analyzer';
import {
  getSkillsDir,
  addToApprovedList,
  removeFromApprovedList,
} from '../watchers/skills';

export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /marketplace/search?q=keyword
   */
  app.get(
    '/marketplace/search',
    async (
      request: FastifyRequest<{ Querystring: { q?: string } }>,
      reply: FastifyReply
    ) => {
      const q = request.query.q;
      if (!q || typeof q !== 'string') {
        return reply.code(400).send({ error: 'Query parameter "q" is required' });
      }

      try {
        const results = await searchMarketplace(q);
        return reply.send({ data: results });
      } catch (err) {
        console.error('[Marketplace] Search failed:', (err as Error).message);
        return reply.code(502).send({ error: 'Upstream service unavailable' });
      }
    }
  );

  /**
   * GET /marketplace/skills/:slug
   */
  app.get(
    '/marketplace/skills/:slug',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.params;
      if (!slug || typeof slug !== 'string') {
        return reply.code(400).send({ error: 'Skill slug is required' });
      }

      try {
        const skill = await getMarketplaceSkill(slug);
        return reply.send({ data: skill });
      } catch (err) {
        console.error('[Marketplace] Detail failed:', (err as Error).message);
        return reply.code(502).send({ error: 'Upstream service unavailable' });
      }
    }
  );

  /**
   * POST /marketplace/analyze
   */
  app.post(
    '/marketplace/analyze',
    async (
      request: FastifyRequest<{ Body: { files: MarketplaceSkillFile[]; skillName?: string; publisher?: string } }>,
      reply: FastifyReply
    ) => {
      const { files, skillName, publisher } = request.body ?? {};
      if (!Array.isArray(files) || files.length === 0) {
        return reply.code(400).send({ error: 'Files array is required' });
      }

      try {
        const result = await analyzeSkillBundle(files, skillName, publisher);
        return reply.send({ data: result });
      } catch (err) {
        console.error('[Marketplace] Analyze failed:', (err as Error).message);
        return reply.code(502).send({ error: 'Upstream service unavailable' });
      }
    }
  );

  /**
   * GET /marketplace/analysis?skillName=X&publisher=Y
   * Returns cached analysis or 404 if not found.
   */
  app.get(
    '/marketplace/analysis',
    async (
      request: FastifyRequest<{ Querystring: { skillName?: string; publisher?: string } }>,
      reply: FastifyReply
    ) => {
      const { skillName, publisher } = request.query;
      if (!skillName || !publisher) {
        return reply.code(400).send({
          error: 'Both "skillName" and "publisher" query parameters are required',
        });
      }

      try {
        const result = await getCachedAnalysis(skillName, publisher);
        if (!result) {
          return reply.code(404).send({ error: 'No cached analysis found' });
        }
        return reply.send({ data: result });
      } catch (err) {
        console.error('[Marketplace] Cached analysis lookup failed:', (err as Error).message);
        return reply.code(502).send({ error: 'Upstream service unavailable' });
      }
    }
  );

  /**
   * POST /marketplace/install
   */
  app.post(
    '/marketplace/install',
    async (
      request: FastifyRequest<{ Body: InstallSkillRequest }>,
      reply: FastifyReply
    ) => {
      const { slug, files, analysis } = request.body ?? {} as Partial<InstallSkillRequest>;

      // Validate required fields
      if (!slug || !Array.isArray(files) || !analysis) {
        return reply.code(400).send({
          error: 'Request must include slug, files, and analysis',
        });
      }

      // Reject critical vulnerabilities
      if (analysis.vulnerability?.level === 'critical') {
        return reply.code(400).send({
          error: 'Cannot install skill with critical vulnerability level',
        });
      }

      const skillsDir = getSkillsDir();
      if (!skillsDir) {
        return reply.code(500).send({ error: 'Skills directory not configured' });
      }

      const skillDir = path.join(skillsDir, slug);

      try {
        // Pre-approve to prevent race with watcher quarantining
        addToApprovedList(slug);

        // Create skill directory
        fs.mkdirSync(skillDir, { recursive: true });

        // Write each file
        for (const file of files) {
          const filePath = path.join(skillDir, file.name);
          // Ensure subdirectories exist for nested file names
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, file.content, 'utf-8');
        }

        // Run local analysis on the combined content
        const combinedContent = files.map((f) => f.content).join('\n');
        analyzeSkill(slug, combinedContent);

        return reply.send({ data: { success: true, name: slug } });
      } catch (err) {
        // Cleanup on failure
        try {
          if (fs.existsSync(skillDir)) {
            fs.rmSync(skillDir, { recursive: true, force: true });
          }
          removeFromApprovedList(slug);
        } catch {
          // Best-effort cleanup
        }

        console.error('[Marketplace] Install failed:', (err as Error).message);
        return reply.code(500).send({
          error: `Installation failed: ${(err as Error).message}`,
        });
      }
    }
  );
}
