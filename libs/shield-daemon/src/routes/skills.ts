/**
 * Skills Management Routes
 *
 * API endpoints for managing agent skills (approved and quarantined).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { MarketplaceSkillFile } from '@agenshield/ipc';
import { parseSkillMd } from '@agenshield/sandbox';
import {
  listApproved,
  listQuarantined,
  approveSkill,
  rejectSkill,
  revokeSkill,
  getSkillsDir,
  addToApprovedList,
  removeFromApprovedList,
} from '../watchers/skills';
import {
  analyzeSkill,
  getCachedAnalysis,
  clearCachedAnalysis,
} from '../services/skill-analyzer';
import {
  createSkillWrapper,
  removeSkillWrapper,
  addSkillPolicy,
  removeSkillPolicy,
} from '../services/skill-lifecycle';
import { addSkillEntry, removeSkillEntry } from '../services/openclaw-config';
import {
  listDownloadedSkills,
  getDownloadedSkillFiles,
  getDownloadedSkillMeta,
} from '../services/marketplace';
import { requireAuth } from '../auth/middleware';

/** Normalized skill summary for frontend consumption */
interface SkillSummary {
  name: string;
  source: 'user' | 'workspace' | 'quarantine' | 'marketplace';
  status: 'active' | 'workspace' | 'quarantined' | 'disabled' | 'downloaded';
  description?: string;
  path: string;
  publisher?: string;
}

/**
 * Register skills management routes
 */
export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /skills - List all skills as normalized SkillSummary[]
   */
  app.get('/skills', async (_request: FastifyRequest, reply: FastifyReply) => {
    const approved = listApproved();
    const quarantined = listQuarantined();
    const downloaded = listDownloadedSkills();
    const approvedNames = new Set(approved.map((a) => a.name));
    const availableDownloads = downloaded.filter((d) => !approvedNames.has(d.slug));
    const skillsDir = getSkillsDir();

    const data: SkillSummary[] = [
      // Approved → active
      ...approved.map((a) => ({
        name: a.name,
        source: 'user' as const,
        status: 'active' as const,
        path: path.join(skillsDir ?? '', a.name),
        publisher: a.publisher,
        description: undefined,
      })),
      // Quarantined
      ...quarantined.map((q) => ({
        name: q.name,
        source: 'quarantine' as const,
        status: 'quarantined' as const,
        path: q.originalPath,
        description: undefined,
      })),
      // Downloaded (not installed) → available
      ...availableDownloads.map((d) => ({
        name: d.slug,
        source: 'marketplace' as const,
        status: 'downloaded' as const,
        description: d.description,
        path: '',
        publisher: d.author,
      })),
    ];

    return reply.send({ data });
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

  /**
   * PUT /skills/:name/toggle - Enable or disable a marketplace skill.
   * - If active in workspace → disable (remove from workspace, wrapper, config, approved list)
   * - If only in download cache → enable (copy to workspace, create wrapper, add to config)
   */
  app.put(
    '/skills/:name/toggle',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      const skillsDir = getSkillsDir();
      if (!skillsDir) {
        return reply.code(500).send({ error: 'Skills directory not configured' });
      }

      const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
      const binDir = path.join(agentHome, 'bin');
      const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'clawshield';
      const skillDir = path.join(skillsDir, name);
      const isInstalled = fs.existsSync(skillDir);

      if (isInstalled) {
        // DISABLE: Remove from workspace, wrapper, config, approved list
        try {
          fs.rmSync(skillDir, { recursive: true, force: true });
          removeSkillWrapper(name, binDir);
          removeSkillEntry(name);
          removeSkillPolicy(name);
          removeFromApprovedList(name);

          console.log(`[Skills] Disabled marketplace skill: ${name}`);
          return reply.send({ success: true, action: 'disabled', name });
        } catch (err) {
          console.error('[Skills] Disable failed:', (err as Error).message);
          return reply.code(500).send({ error: `Disable failed: ${(err as Error).message}` });
        }
      } else {
        // ENABLE: Copy from download cache to workspace
        const meta = getDownloadedSkillMeta(name);
        if (!meta) {
          return reply.code(404).send({ error: 'Skill not found in download cache' });
        }

        const files = getDownloadedSkillFiles(name);
        if (files.length === 0) {
          return reply.code(404).send({ error: 'No files in download cache for this skill' });
        }

        try {
          // Pre-approve
          addToApprovedList(name, meta.author);

          // Write files to workspace
          fs.mkdirSync(skillDir, { recursive: true });
          for (const file of files) {
            const filePath = path.join(skillDir, file.name);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, file.content, 'utf-8');
          }

          // Set ownership
          try {
            execSync(`chown -R root:${socketGroup} "${skillDir}"`, { stdio: 'pipe' });
            execSync(`chmod -R a+rX,go-w "${skillDir}"`, { stdio: 'pipe' });
          } catch {
            // May fail if not root
          }

          // Create wrapper + config + policy
          createSkillWrapper(name, binDir);
          addSkillEntry(name);
          addSkillPolicy(name);

          console.log(`[Skills] Enabled marketplace skill: ${name}`);
          return reply.send({ success: true, action: 'enabled', name });
        } catch (err) {
          // Cleanup on failure
          try {
            if (fs.existsSync(skillDir)) {
              fs.rmSync(skillDir, { recursive: true, force: true });
            }
            removeFromApprovedList(name);
          } catch {
            // Best-effort cleanup
          }

          console.error('[Skills] Enable failed:', (err as Error).message);
          return reply.code(500).send({ error: `Enable failed: ${(err as Error).message}` });
        }
      }
    }
  );

  /**
   * POST /skills/install - Install a skill (analyze-first, passcode-protected)
   * Body: { name: string, files: MarketplaceSkillFile[], publisher?: string }
   */
  app.post<{
    Body: { name: string; files: MarketplaceSkillFile[]; publisher?: string };
  }>(
    '/skills/install',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { name, files, publisher } = request.body ?? {} as Partial<{ name: string; files: MarketplaceSkillFile[]; publisher?: string }>;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }
      if (!Array.isArray(files) || files.length === 0) {
        return reply.code(400).send({ error: 'Files array is required' });
      }

      // 1. Analyze the skill content
      const combinedContent = files.map((f) => f.content).join('\n');
      const skillMdFile = files.find((f) => f.name === 'SKILL.md');
      let metadata: Record<string, unknown> | undefined;
      if (skillMdFile) {
        const parsed = parseSkillMd(skillMdFile.content);
        metadata = parsed?.metadata as Record<string, unknown>;
      }
      const analysis = analyzeSkill(name, combinedContent, metadata);

      // 2. Reject critical vulnerabilities
      if (analysis.vulnerability?.level === 'critical') {
        return reply.code(400).send({ error: 'Critical vulnerability detected', analysis });
      }

      const skillsDir = getSkillsDir();
      if (!skillsDir) {
        return reply.code(500).send({ error: 'Skills directory not configured' });
      }

      const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
      const binDir = path.join(agentHome, 'bin');
      const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'clawshield';
      const skillDir = path.join(skillsDir, name);

      try {
        // 3. Pre-approve to prevent watcher quarantine race
        addToApprovedList(name, publisher);

        // 4. Write files to $AGENT_HOME/.openclaw/skills/<name>/
        fs.mkdirSync(skillDir, { recursive: true });
        for (const file of files) {
          const filePath = path.join(skillDir, file.name);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, file.content, 'utf-8');
        }

        // 5. Set ownership (root-owned, agent-readable)
        try {
          execSync(`chown -R root:${socketGroup} "${skillDir}"`, { stdio: 'pipe' });
          execSync(`chmod -R a+rX,go-w "${skillDir}"`, { stdio: 'pipe' });
        } catch {
          // May fail if not root — acceptable in development
        }

        // 6. Create wrapper in $AGENT_HOME/bin/<name>
        createSkillWrapper(name, binDir);

        // 7. Add policy rule
        addSkillPolicy(name);

        return reply.send({ success: true, name, analysis });
      } catch (err) {
        // Cleanup on failure
        try {
          if (fs.existsSync(skillDir)) {
            fs.rmSync(skillDir, { recursive: true, force: true });
          }
          removeFromApprovedList(name);
        } catch {
          // Best-effort cleanup
        }

        console.error('[Skills] Install failed:', (err as Error).message);
        return reply.code(500).send({
          error: `Installation failed: ${(err as Error).message}`,
        });
      }
    }
  );
}

