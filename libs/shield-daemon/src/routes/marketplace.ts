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
  inlineImagesInMarkdown,
  markDownloadedAsInstalled,
} from '../services/marketplace';
import { setCachedAnalysis } from '../services/skill-analyzer';
import { daemonEvents, emitSkillInstallProgress, emitSkillAnalyzed, emitSkillAnalysisFailed } from '../events/emitter';
import { stripEnvFromSkillMd } from '@agenshield/sandbox';
import { injectInstallationTag } from '../services/skill-tag-injector';
import { executeSkillInstallSteps } from '../services/skill-deps';
import { getSkillsDir } from '../config/paths';

/* ── Install-in-progress tracking ───────────────────────── */
const installInProgress = new Set<string>();

/** Check if a skill is currently being installed (for GET /skills to report status) */
export function isInstallInProgress(slug: string): boolean {
  return installInProgress.has(slug);
}

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
        const installedSkills = app.skillManager.getRepository().getInstalledSkills();
        const installedSlugs = new Set(installedSkills.map(s => s.slug));
        const enriched = results.map(skill => ({
          ...skill,
          installed: installedSlugs.has(skill.slug),
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

          // Inline images in readme so markdown renders them properly
          let readme = readmeFile?.content;
          if (readme) {
            readme = inlineImagesInMarkdown(readme, localFiles);
          }

          const skill = {
            name: localMeta.name,
            slug: localMeta.slug,
            description: localMeta.description,
            author: localMeta.author,
            version: localMeta.version,
            installs: 0, // Not stored locally
            tags: localMeta.tags,
            readme,
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
              // Also cache in skill-analyzer so GET /skills/:name returns full data
              const a = result.analysis;
              setCachedAnalysis(slug, {
                status: a.status === 'complete' ? 'complete' : 'error',
                analyzerId: 'agenshield',
                commands: a.commands?.map(c => ({
                  name: c.name,
                  source: c.source as 'metadata' | 'analysis',
                  available: c.available,
                  required: c.required,
                })) ?? [],
                vulnerability: a.vulnerability,
                envVariables: a.envVariables,
                runtimeRequirements: a.runtimeRequirements,
                installationSteps: a.installationSteps,
                runCommands: a.runCommands,
                securityFindings: a.securityFindings,
                mcpSpecificRisks: a.mcpSpecificRisks,
              });
              console.log(`[Marketplace] Analysis complete for ${slug}`);
              emitSkillAnalyzed(slug, result.analysis);
            })
            .catch((err) => {
              console.warn(`[Marketplace] Auto-analysis failed for ${slug}: ${(err as Error).message}`);
              updateDownloadedAnalysis(slug, {
                status: 'error',
                vulnerability: { level: 'safe', details: [`Analysis failed: ${(err as Error).message}`] },
                commands: [],
              });
              emitSkillAnalysisFailed(slug, (err as Error).message);
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
            // Also cache in skill-analyzer so GET /skills/:name returns full data
            const a = result.analysis;
            setCachedAnalysis(slug, {
              status: a.status === 'complete' ? 'complete' : 'error',
              analyzerId: 'agenshield',
              commands: a.commands?.map(c => ({
                name: c.name,
                source: c.source as 'metadata' | 'analysis',
                available: c.available,
                required: c.required,
              })) ?? [],
              vulnerability: a.vulnerability,
              envVariables: a.envVariables,
              runtimeRequirements: a.runtimeRequirements,
              installationSteps: a.installationSteps,
              runCommands: a.runCommands,
              securityFindings: a.securityFindings,
              mcpSpecificRisks: a.mcpSpecificRisks,
            });
            console.log(`[Marketplace] Analysis complete for ${slug}`);
            emitSkillAnalyzed(slug, result.analysis);
          })
          .catch((err) => {
            console.warn(`[Marketplace] Auto-analysis failed for ${slug}: ${(err as Error).message}`);
            updateDownloadedAnalysis(slug, {
              status: 'error',
              vulnerability: { level: 'safe', details: [`Analysis failed: ${(err as Error).message}`] },
              commands: [],
            });
            emitSkillAnalysisFailed(slug, (err as Error).message);
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
      request: FastifyRequest<{ Body: InstallSkillRequest; Querystring: { sync?: string } }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.body ?? {} as Partial<InstallSkillRequest>;
      const sync = request.query.sync === 'true';

      if (!slug) {
        return reply.code(400).send({ error: 'Request must include slug' });
      }

      // Prevent duplicate installs
      if (installInProgress.has(slug)) {
        return reply.code(409).send({ error: `Installation already in progress for "${slug}"` });
      }

      installInProgress.add(slug);

      // ── Shared install pipeline ──────────────────────────────
      const runInstall = async (): Promise<{
        success: boolean;
        name: string;
        analysis?: Awaited<ReturnType<typeof analyzeSkillBundle>>['analysis'];
        logs: string[];
        depsSuccess?: boolean;
      }> => {
        const logs: string[] = [];
        let analysisResult: Awaited<ReturnType<typeof analyzeSkillBundle>>['analysis'] | undefined;
        const skillsDir = getSkillsDir();
        let skillDir = skillsDir ? path.join(skillsDir, slug) : '';

        try {
          // 1. Emit start event
          daemonEvents.broadcast('skills:install_started', { name: slug });
          logs.push('Installation started');

          // 2. Analyze FIRST (remote analyzer downloads ZIP itself - no local download yet)
          emitSkillInstallProgress(slug, 'analyze', 'Analyzing skill bundle');
          const analyzeResponse = await analyzeSkillBySlug(slug);
          analysisResult = analyzeResponse.analysis;
          logs.push('Analysis complete');

          // 2b. Cache analysis in legacy stores so GET /skills/:name returns it
          //     (even if install is rejected due to critical vulnerability)
          {
            const a = analysisResult;
            try {
              setCachedAnalysis(slug, {
                status: a.status === 'complete' ? 'complete' : 'error',
                analyzerId: 'agenshield',
                commands: a.commands?.map(c => ({
                  name: c.name,
                  source: c.source as 'metadata' | 'analysis',
                  available: c.available,
                  required: c.required,
                })) ?? [],
                vulnerability: a.vulnerability,
                envVariables: a.envVariables,
                runtimeRequirements: a.runtimeRequirements,
                installationSteps: a.installationSteps,
                runCommands: a.runCommands,
                securityFindings: a.securityFindings,
                mcpSpecificRisks: a.mcpSpecificRisks,
                error: a.status === 'error' ? 'Analysis returned error' : undefined,
              });
              updateDownloadedAnalysis(slug, analysisResult);
            } catch { /* best-effort */ }
          }

          // 3. Reject critical vulnerabilities BEFORE local download
          if (analysisResult.vulnerability?.level === 'critical') {
            daemonEvents.broadcast('skills:install_failed', {
              name: slug,
              error: 'Critical vulnerability detected',
              analysis: analysisResult,
            });
            return { success: false, name: slug, analysis: analysisResult, logs, depsSuccess: undefined };
          }

          // 4. Download skill files (only after analysis passes)
          emitSkillInstallProgress(slug, 'download', 'Downloading skill files');
          const skill = await getMarketplaceSkill(slug);
          const files: MarketplaceSkillFile[] = skill.files ?? getDownloadedSkillFiles(slug);
          if (files.length === 0) {
            daemonEvents.broadcast('skills:install_failed', {
              name: slug,
              error: 'No files available for installation',
            });
            return { success: false, name: slug, analysis: analysisResult, logs, depsSuccess: undefined };
          }
          const publisher = skill.author;
          logs.push('Downloaded skill files');

          // 5. Strip env vars and inject installation tag BEFORE uploading to DB
          emitSkillInstallProgress(slug, 'copy', 'Preparing skill files');
          const taggedFiles = await Promise.all(files.map(async (f) => {
            let content = f.content;
            if (/SKILL\.md$/i.test(f.name)) {
              content = stripEnvFromSkillMd(content);
              content = await injectInstallationTag(content);
            }
            return { ...f, content };
          }));

          // 6. Upload files to SQLite via SkillManager
          emitSkillInstallProgress(slug, 'approve', 'Registering skill');
          const manager = app.skillManager;
          manager.uploadFiles({
            name: skill.name ?? slug,
            slug,
            version: skill.version ?? '0.0.0',
            author: publisher,
            description: skill.description,
            tags: skill.tags,
            source: 'marketplace',
            files: taggedFiles.map((f) => ({
              relativePath: f.name,
              content: Buffer.from(f.content, 'utf-8'),
            })),
          });
          logs.push('Skill registered in database');

          // Suppress watcher during file write + deploy to prevent false "no active installation" alerts
          manager.getWatcher().suppressSlug(slug);
          let installation: Awaited<ReturnType<typeof manager.approveSkill>>;
          try {
            // Write raw files to workspace/skills/{slug}/ so deploy adapter can read them
            if (skillsDir) {
              const destDir = path.join(skillsDir, slug);
              fs.mkdirSync(destDir, { recursive: true });
              for (const f of files) {
                const filePath = path.join(destDir, f.name);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, f.content, 'utf-8');
              }
            }

            // 6b. Store analysis in DB version
            const repo = manager.getRepository();
            const dbSkill = repo.getBySlug(slug);
            if (dbSkill) {
              const version = repo.getLatestVersion(dbSkill.id);
              if (version) {
                repo.updateAnalysis(version.id, {
                  status: analysisResult.status === 'complete' ? 'complete' : 'error',
                  json: analysisResult,
                  analyzedAt: new Date().toISOString(),
                });
              }
            }

            // 7. Approve + Deploy (DaemonDeployAdapter handles: broker/sudo, wrapper, policy, file ownership)
            emitSkillInstallProgress(slug, 'copy', 'Deploying skill files');
            const ctx = request.shieldContext;
            installation = await manager.approveSkill(slug, {
              targetId: ctx.targetId ?? undefined,
              userUsername: ctx.userUsername ?? undefined,
            });
          } finally {
            manager.getWatcher().unsuppressSlug(slug);
          }
          logs.push('Skill approved and deployed');
          if (installation.wrapperPath) {
            logs.push(`Wrapper created: ${installation.wrapperPath}`);
          }

          // 8. Execute dependency install steps from skill metadata
          let depsSuccess = true;
          emitSkillInstallProgress(slug, 'deps', 'Installing skill dependencies');
          const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
          const agentUsername = path.basename(agentHome);
          skillDir = skillsDir ? path.join(skillsDir, slug) : '';

          try {
            let depsLineCount = 0;
            let depsLastEmit = Date.now();
            const DEPS_DEBOUNCE_MS = 3000;
            const depsOnLog = (msg: string) => {
              depsLineCount++;
              if (/^(Installing|Found|Verifying)\s/.test(msg)) {
                emitSkillInstallProgress(slug, 'deps', msg);
                depsLastEmit = Date.now();
                return;
              }
              const now = Date.now();
              if (now - depsLastEmit >= DEPS_DEBOUNCE_MS) {
                emitSkillInstallProgress(slug, 'deps', `Installing... (${depsLineCount} lines)`);
                depsLastEmit = now;
              }
            };

            const depsResult = await executeSkillInstallSteps({
              slug,
              skillDir,
              agentHome,
              agentUsername,
              onLog: depsOnLog,
            });

            if (depsLineCount > 0) {
              emitSkillInstallProgress(slug, 'deps', `Dependency install complete (${depsLineCount} lines processed)`);
            }

            if (depsResult.installed.length > 0) {
              logs.push(`Dependencies installed: ${depsResult.installed.join(', ')}`);
            }
            if (depsResult.errors.length > 0) {
              depsSuccess = false;
              for (const err of depsResult.errors) {
                emitSkillInstallProgress(slug, 'warning', `Dependency warning: ${err}`);
                logs.push(`Dependency warning: ${err}`);
              }
            }
          } catch (err) {
            depsSuccess = false;
            const msg = `Dependency installation failed: ${(err as Error).message}`;
            emitSkillInstallProgress(slug, 'warning', msg);
            logs.push(msg);
          }

          // 9. Recompute integrity hash in DB
          {
            const repo = manager.getRepository();
            const dbSkill = repo.getBySlug(slug);
            if (dbSkill) {
              const version = repo.getLatestVersion(dbSkill.id);
              if (version) {
                try {
                  repo.recomputeContentHash(version.id);
                  logs.push('Integrity hash recorded');
                } catch { /* best-effort */ }
              }
            }
          }

          // 10. Mark marketplace cache as installed (preserves metadata for re-enable)
          try { markDownloadedAsInstalled(slug); } catch { /* best-effort */ }

          // 11. Clear install flag BEFORE broadcast so GET /skills never returns stale 'installing'
          installInProgress.delete(slug);
          const depsWarnings = depsSuccess ? undefined : logs.filter(l => l.startsWith('Dependency'));
          daemonEvents.broadcast('skills:installed', { name: slug, analysis: analysisResult, depsWarnings });
          logs.push('Installation complete');

          return { success: true, name: slug, analysis: analysisResult, logs, depsSuccess };
        } catch (err) {
          // Cleanup on failure: revoke skill in DB (removes installation, quarantines version)
          try {
            await app.skillManager.revokeSkill(slug);
          } catch {
            // Best-effort cleanup — skill may not exist in DB yet
          }

          const errorMsg = (err as Error).message;
          installInProgress.delete(slug);
          daemonEvents.broadcast('skills:install_failed', { name: slug, error: errorMsg });
          console.error('[Marketplace] Install failed:', errorMsg);
          return { success: false, name: slug, analysis: analysisResult, logs: [...logs, `Error: ${errorMsg}`], depsSuccess: undefined };
        } finally {
          installInProgress.delete(slug);
        }
      };

      // ── Sync mode (CLI backward compat): block until done ──
      if (sync) {
        const result = await runInstall();
        if (!result.success) {
          return reply.code(500).send({
            error: `Installation failed`,
            data: result,
          });
        }
        return reply.send({ data: result });
      }

      // ── Async mode (frontend): return 202 immediately ──
      setImmediate(() => { runInstall(); });
      return reply.code(202).send({ data: { status: 'accepted', name: slug } });
    }
  );
}
