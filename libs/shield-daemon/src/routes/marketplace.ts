/**
 * Marketplace Routes
 *
 * Proxy endpoints for ClawHub marketplace search/detail,
 * agen.co vulnerability analysis, and local skill installation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  MarketplaceSkillFile,
  InstallSkillRequest,
} from '@agenshield/ipc';
import {
  searchMarketplace,
  getMarketplaceSkill,
  analyzeSkillBundle,
  analyzeSkillBySlug,
  getCachedAnalysis,
  getDownloadedSkillFiles,
  getDownloadedSkillMeta,
  updateDownloadedAnalysis,
  downloadAndExtractZip,
  storeDownloadedSkill,
} from '../services/marketplace';
import { analyzeSkill } from '../services/skill-analyzer';
import {
  createSkillWrapper,
  addSkillPolicy,
} from '../services/skill-lifecycle';
import {
  getSkillsDir,
  addToApprovedList,
  removeFromApprovedList,
  listApproved,
} from '../watchers/skills';
import { daemonEvents, emitSkillInstallProgress } from '../events/emitter';
import {
  isBrokerAvailable,
  installSkillViaBroker,
} from '../services/broker-bridge';

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
        const approved = listApproved();
        const approvedSlugs = new Set(approved.map(a => a.name));
        const enriched = results.map(skill => ({
          ...skill,
          installed: approvedSlugs.has(skill.slug),
        }));
        return reply.send({ data: enriched });
      } catch (err) {
        console.error('[Marketplace] Search failed:', (err as Error).message);
        return reply.code(502).send({ error: 'Upstream service unavailable' });
      }
    }
  );

  /**
   * GET /marketplace/skills/:slug
   * Returns skill details immediately. Uses local cache if available, otherwise fetches remote.
   * Analysis runs async in background if not cached.
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
        // Check if skill is already downloaded locally
        const localMeta = getDownloadedSkillMeta(slug);

        if (localMeta) {
          // Use local data - reconstruct skill from downloaded cache
          const localFiles = getDownloadedSkillFiles(slug);
          const readmeFile = localFiles.find(f => /readme|skill\.md/i.test(f.name));

          const skill = {
            name: localMeta.name,
            slug: localMeta.slug,
            description: localMeta.description,
            author: localMeta.author,
            version: localMeta.version,
            installs: 0, // Not stored locally
            tags: localMeta.tags,
            readme: readmeFile?.content,
            files: localFiles,
          };

          if (localMeta.analysis) {
            const analysisStatus = localMeta.analysis.status === 'error' ? 'error' : 'complete';
            return reply.send({ data: { ...skill, analysis: localMeta.analysis, analysisStatus } });
          }

          // Return immediately with pending status, trigger analysis
          reply.send({ data: { ...skill, analysis: null, analysisStatus: 'pending' } });

          // Trigger analysis async (fire-and-forget)
          console.log(`[Marketplace] Auto-analyzing downloaded skill in background: ${slug}`);
          analyzeSkillBySlug(slug, skill.name, skill.author)
            .then((result) => {
              updateDownloadedAnalysis(slug, result.analysis);
              console.log(`[Marketplace] Analysis complete for ${slug}`);
            })
            .catch((err) => {
              console.warn(`[Marketplace] Auto-analysis failed for ${slug}: ${(err as Error).message}`);
              updateDownloadedAnalysis(slug, {
                status: 'error',
                vulnerability: { level: 'safe', details: [`Analysis failed: ${(err as Error).message}`] },
                commands: [],
              });
            });
          return;
        }

        // Not downloaded locally - fetch from remote
        const skill = await getMarketplaceSkill(slug);

        // Check for cached analysis from download metadata (may have been stored during fetch)
        const cachedAnalysis = getDownloadedSkillMeta(slug)?.analysis;

        if (cachedAnalysis) {
          const analysisStatus = cachedAnalysis.status === 'error' ? 'error' : 'complete';
          return reply.send({ data: { ...skill, analysis: cachedAnalysis, analysisStatus } });
        }

        // Return immediately with pending status (don't block)
        reply.send({ data: { ...skill, analysis: null, analysisStatus: 'pending' } });

        // Trigger analysis async (fire-and-forget)
        console.log(`[Marketplace] Auto-analyzing skill in background: ${slug}`);
        analyzeSkillBySlug(slug, skill.name, skill.author)
          .then((result) => {
            updateDownloadedAnalysis(slug, result.analysis);
            console.log(`[Marketplace] Analysis complete for ${slug}`);
          })
          .catch((err) => {
            console.warn(`[Marketplace] Auto-analysis failed for ${slug}: ${(err as Error).message}`);
            updateDownloadedAnalysis(slug, {
              status: 'error',
              vulnerability: { level: 'safe', details: [`Analysis failed: ${(err as Error).message}`] },
              commands: [],
            });
          });
      } catch (err) {
        console.error('[Marketplace] Detail failed:', (err as Error).message);
        return reply.code(502).send({ error: 'Upstream service unavailable' });
      }
    }
  );

  /**
   * POST /marketplace/analyze
   * Accepts { files, skillName, publisher, slug? }.
   * If slug is provided and files is empty, loads files from the download cache.
   */
  app.post(
    '/marketplace/analyze',
    async (
      request: FastifyRequest<{
        Body: { files?: MarketplaceSkillFile[]; skillName?: string; publisher?: string; slug?: string; source?: 'clawhub' };
      }>,
      reply: FastifyReply
    ) => {
      const { files, skillName, publisher, slug, source } = request.body ?? {};

      // New path: slug + source → forward directly to Vercel (no local files needed)
      if (slug && source === 'clawhub') {
        try {
          const result = await analyzeSkillBySlug(slug, skillName ?? slug, publisher ?? source);

          // Best-effort: store analysis in download metadata if skill was previously downloaded
          try { updateDownloadedAnalysis(slug, result.analysis); } catch { /* best-effort */ }

          return reply.send({ data: result });
        } catch (err) {
          console.error('[Marketplace] Analyze by slug failed:', (err as Error).message);
          return reply.code(502).send({ error: 'Upstream service unavailable' });
        }
      }

      // Existing path: files (or slug → load from cache)
      let resolvedFiles = files;
      if ((!Array.isArray(resolvedFiles) || resolvedFiles.length === 0) && slug) {
        resolvedFiles = getDownloadedSkillFiles(slug);
      }

      if (!Array.isArray(resolvedFiles) || resolvedFiles.length === 0) {
        return reply.code(400).send({ error: 'Files array is required (or provide slug for cached files)' });
      }

      try {
        const result = await analyzeSkillBundle(resolvedFiles, skillName, publisher);

        // Store analysis result in download metadata
        if (slug) {
          try {
            updateDownloadedAnalysis(slug, result.analysis);
          } catch {
            // Best-effort
          }
        }

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
   * Accepts { slug } and handles the full lifecycle:
   * download → analyze → install → approve → wrapper → policy
   */
  app.post(
    '/marketplace/install',
    async (
      request: FastifyRequest<{ Body: InstallSkillRequest }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.body ?? {} as Partial<InstallSkillRequest>;

      if (!slug) {
        return reply.code(400).send({ error: 'Request must include slug' });
      }

      const logs: string[] = [];
      let analysisResult: Awaited<ReturnType<typeof analyzeSkillBundle>>['analysis'] | undefined;
      let skillDir = '';

      try {
        // 1. Emit start event
        daemonEvents.broadcast('skills:install_started', { name: slug });
        logs.push('Installation started');

        // 2. Analyze FIRST (remote analyzer downloads ZIP itself - no local download yet)
        emitSkillInstallProgress(slug, 'analyze', 'Analyzing skill bundle');
        const analyzeResponse = await analyzeSkillBySlug(slug);
        analysisResult = analyzeResponse.analysis;
        logs.push('Analysis complete');

        // 3. Reject critical vulnerabilities BEFORE local download
        if (analysisResult.vulnerability?.level === 'critical') {
          daemonEvents.broadcast('skills:install_failed', {
            name: slug,
            error: 'Critical vulnerability detected',
          });
          return reply.code(400).send({
            error: 'Cannot install skill with critical vulnerability level',
            data: { success: false, name: slug, analysis: analysisResult, logs },
          });
        }

        // 4. Download skill files (only after analysis passes)
        emitSkillInstallProgress(slug, 'download', 'Downloading skill files');
        const skill = await getMarketplaceSkill(slug);
        const files: MarketplaceSkillFile[] = skill.files ?? getDownloadedSkillFiles(slug);
        if (files.length === 0) {
          return reply.code(400).send({ error: 'No files available for installation' });
        }
        const publisher = skill.author;
        logs.push('Downloaded skill files');

        // 5. Prepare directories
        const skillsDir = getSkillsDir();
        if (!skillsDir) {
          return reply.code(500).send({ error: 'Skills directory not configured' });
        }

        const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
        const binDir = path.join(agentHome, 'bin');
        const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'clawshield';
        skillDir = path.join(skillsDir, slug);

        // 6. Pre-approve to prevent race with watcher quarantining
        emitSkillInstallProgress(slug, 'approve', 'Pre-approving skill');
        addToApprovedList(slug, publisher);
        logs.push('Skill pre-approved');

        // 7. Install files via broker (handles mkdir, write, chown, wrapper creation)
        emitSkillInstallProgress(slug, 'copy', 'Writing skill files via broker');

        // Check if broker is available
        const brokerAvailable = await isBrokerAvailable();
        if (!brokerAvailable) {
          throw new Error('Broker is not available. Skill installation requires the broker daemon to be running.');
        }

        // Install via broker - it handles mkdir, file writes, chown, and wrapper creation
        const brokerResult = await installSkillViaBroker(
          slug,
          files.map((f) => ({ name: f.name, content: f.content })),
          {
            createWrapper: true,
            agentHome,
            socketGroup,
          }
        );

        if (!brokerResult.installed) {
          throw new Error('Broker failed to install skill files');
        }

        skillDir = brokerResult.skillDir;
        logs.push(`Files written via broker: ${brokerResult.filesWritten} files`);
        if (brokerResult.wrapperPath) {
          logs.push(`Wrapper created: ${brokerResult.wrapperPath}`);
        }

        // 10. OpenClaw config entry is written by the broker during install

        // 11. Add policy rule
        addSkillPolicy(slug);
        logs.push('Policy rule added');

        // 12. Run local analysis
        emitSkillInstallProgress(slug, 'local_analysis', 'Running local analysis');
        const combinedContent = files.map((f) => f.content).join('\n');
        analyzeSkill(slug, combinedContent);
        logs.push('Local analysis complete');

        // 13. Store analysis in download metadata
        try {
          updateDownloadedAnalysis(slug, analysisResult);
        } catch {
          // Best-effort
        }

        // 14. Emit installed event
        daemonEvents.broadcast('skills:installed', { name: slug });
        logs.push('Installation complete');

        return reply.send({
          data: { success: true, name: slug, analysis: analysisResult, logs },
        });
      } catch (err) {
        // Cleanup on failure
        try {
          if (skillDir && fs.existsSync(skillDir)) {
            fs.rmSync(skillDir, { recursive: true, force: true });
          }
          removeFromApprovedList(slug);
        } catch {
          // Best-effort cleanup
        }

        const errorMsg = (err as Error).message;
        daemonEvents.broadcast('skills:install_failed', { name: slug, error: errorMsg });
        console.error('[Marketplace] Install failed:', errorMsg);
        return reply.code(500).send({
          error: `Installation failed: ${errorMsg}`,
          data: {
            success: false,
            name: slug,
            analysis: analysisResult,
            logs: [...logs, `Error: ${errorMsg}`],
          },
        });
      }
    }
  );
}
