/**
 * Skills Management Routes
 *
 * API endpoints for managing agent skills (approved and quarantined).
 * Backed by SkillManager + SQLite via @agentshield/skills.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { MarketplaceSkillFile, Skill, SkillVersion, SkillInstallation } from '@agenshield/ipc';
import { parseSkillMd, stripEnvFromSkillMd } from '@agenshield/sandbox';
import { isInstallInProgress } from './marketplace';
import { requireAuth } from '../auth/middleware';
import {
  getDownloadedSkillFiles,
  getDownloadedSkillMeta,
  getMarketplaceSkill,
  storeDownloadedSkill,
  inlineImagesInMarkdown,
  analyzeSkillBySlug,
  analyzeSkillBundle,
} from '../services/marketplace';
import { emitSkillAnalyzed, emitSkillAnalysisFailed, emitSkillUninstalled } from '../events/emitter';

/** Compact analysis for list view — no full details/suggestions */
interface SkillAnalysisSummary {
  status: 'pending' | 'analyzing' | 'complete' | 'error' | 'installing';
  vulnerabilityLevel?: string;
  error?: string;
  commands?: Array<{ name: string; available: boolean }>;
  envVariables?: Array<{ name: string; required: boolean; sensitive: boolean; purpose?: string }>;
}

/** Normalized skill summary for frontend consumption */
interface SkillSummary {
  name: string;
  source: 'user' | 'workspace' | 'quarantine' | 'marketplace' | 'untrusted';
  status: 'active' | 'workspace' | 'quarantined' | 'disabled' | 'downloaded' | 'untrusted';
  description?: string;
  path: string;
  publisher?: string;
  version?: string;
  author?: string;
  tags?: string[];
  trusted?: boolean;
  analysis?: SkillAnalysisSummary;
}

/**
 * Recursively search for SKILL.md or README.md in a directory tree.
 */
function findSkillMdRecursive(dir: string, depth = 0): string | null {
  if (depth > 3) return null;
  try {
    for (const name of ['SKILL.md', 'skill.md', 'README.md', 'readme.md']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = findSkillMdRecursive(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  } catch {
    // Directory may not exist or be unreadable
  }
  return null;
}

/**
 * Read metadata from a skill's SKILL.md frontmatter.
 */
function readSkillMetadata(skillDir: string): {
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
} {
  try {
    const mdPath = findSkillMdRecursive(skillDir);
    if (!mdPath) return {};
    const content = fs.readFileSync(mdPath, 'utf-8');
    const parsed = parseSkillMd(content);
    const meta = parsed?.metadata as Record<string, unknown> | undefined;
    return {
      description: meta?.description as string | undefined,
      version: meta?.version as string | undefined,
      author: meta?.author as string | undefined,
      tags: Array.isArray(meta?.tags) ? meta.tags as string[] : undefined,
    };
  } catch {
    return {};
  }
}

/** Build compact SkillAnalysisSummary for frontend consumption. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAnalysisSummary(name: string, rawAnalysis?: any): SkillAnalysisSummary | undefined {
  const installing = isInstallInProgress(name);
  if (!rawAnalysis || !['complete', 'pending', 'analyzing', 'error'].includes(rawAnalysis.status)) {
    return installing ? { status: 'installing' } : undefined;
  }
  return {
    status: installing ? 'installing' : rawAnalysis.status as SkillAnalysisSummary['status'],
    vulnerabilityLevel: rawAnalysis.status === 'complete' ? rawAnalysis.vulnerability?.level : undefined,
    error: rawAnalysis.status === 'error' ? rawAnalysis.error : undefined,
    commands: rawAnalysis.status === 'complete' && Array.isArray(rawAnalysis.commands)
      ? rawAnalysis.commands.map((c: { name: string; available: boolean }) => ({ name: c.name, available: c.available }))
      : undefined,
    envVariables: rawAnalysis.status === 'complete' && Array.isArray(rawAnalysis.envVariables)
      ? rawAnalysis.envVariables.map((e: { name: string; required: boolean; sensitive: boolean; purpose?: string }) => ({ name: e.name, required: e.required, sensitive: e.sensitive, purpose: e.purpose }))
      : undefined,
  };
}

/** Full analysis for detail view — includes all rich fields from Vercel analyzer */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFullAnalysis(name: string, rawAnalysis?: any): object | undefined {
  const installing = isInstallInProgress(name);
  if (!rawAnalysis || !['complete', 'pending', 'analyzing', 'error'].includes(rawAnalysis.status)) {
    return installing ? { status: 'installing' } : undefined;
  }
  return {
    status: installing ? 'installing' : rawAnalysis.status,
    vulnerabilityLevel: rawAnalysis.vulnerability?.level,
    error: rawAnalysis.error,
    vulnerability: rawAnalysis.vulnerability,
    commands: rawAnalysis.commands,
    envVariables: rawAnalysis.envVariables,
    runtimeRequirements: rawAnalysis.runtimeRequirements,
    installationSteps: rawAnalysis.installationSteps,
    runCommands: rawAnalysis.runCommands,
    securityFindings: rawAnalysis.securityFindings,
    mcpSpecificRisks: rawAnalysis.mcpSpecificRisks,
  };
}

/**
 * Map DB entities to the SkillSummary shape the UI expects.
 */
function mapToSummary(
  skill: Skill,
  version: SkillVersion | undefined,
  installation: SkillInstallation | undefined,
  skillsDir: string,
): SkillSummary {
  const isActive = installation?.status === 'active';
  const isQuarantined = version?.approval === 'quarantined';
  const isDisabled = installation?.status === 'disabled';
  const isTrusted = skill.slug === 'agenco' || skill.slug.startsWith('agenco-');

  // Read on-disk metadata (may augment DB data)
  const onDiskDir = path.join(skillsDir, skill.slug);
  const hasDiskPresence = fs.existsSync(onDiskDir);
  const diskMeta = hasDiskPresence ? readSkillMetadata(onDiskDir) : {};

  let source: SkillSummary['source'];
  let status: SkillSummary['status'];

  if (isActive) {
    source = 'user';
    status = 'active';
  } else if (isQuarantined) {
    source = 'untrusted';
    status = 'untrusted';
  } else if (isDisabled) {
    source = 'marketplace';
    status = 'disabled';
  } else if (hasDiskPresence && !installation) {
    source = 'workspace';
    status = 'workspace';
  } else {
    source = 'marketplace';
    status = 'downloaded';
  }

  // Build analysis from version.analysisJson or marketplace download meta
  const dlMeta = getDownloadedSkillMeta(skill.slug);
  const analysisJson = version?.analysisJson ?? dlMeta?.analysis;

  return {
    name: skill.slug,
    source,
    status,
    path: isActive || hasDiskPresence ? onDiskDir : '',
    publisher: skill.author,
    description: diskMeta.description ?? skill.description,
    version: diskMeta.version ?? version?.version,
    author: diskMeta.author ?? skill.author,
    tags: diskMeta.tags ?? skill.tags,
    trusted: isTrusted || undefined,
    analysis: buildAnalysisSummary(skill.slug, analysisJson),
  };
}

/**
 * Register skills management routes
 */
export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /skills - List all skills as normalized SkillSummary[]
   */
  app.get('/skills', async (request: FastifyRequest, reply: FastifyReply) => {
    const { shieldContext: ctx } = request;
    request.log.info({ targetId: ctx.targetId }, 'Listing skills');

    const manager = app.skillManager;
    const repo = manager.getRepository();
    const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
    const skillsDir = `${agentHome}/.openclaw/workspace/skills`;

    // Get all skills from DB
    const allSkills = repo.getAll();
    const allInstallations = repo.getInstallations();
    const installByVersionId = new Map<string, SkillInstallation>();
    for (const inst of allInstallations) {
      // Keep the "best" installation: active > disabled > quarantined
      const existing = installByVersionId.get(inst.skillVersionId);
      if (!existing || (inst.status === 'active' && existing.status !== 'active')) {
        installByVersionId.set(inst.skillVersionId, inst);
      }
    }

    const data: SkillSummary[] = [];
    const knownSlugs = new Set<string>();

    for (const skill of allSkills) {
      knownSlugs.add(skill.slug);
      const version = repo.getLatestVersion(skill.id);
      const installation = version ? installByVersionId.get(version.id) : undefined;
      data.push(mapToSummary(skill, version ?? undefined, installation, skillsDir));
    }

    // Also check for on-disk skills not yet in DB (workspace skills)
    try {
      if (fs.existsSync(skillsDir)) {
        const onDiskNames = fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);

        for (const name of onDiskNames) {
          if (knownSlugs.has(name)) continue;
          const meta = readSkillMetadata(path.join(skillsDir, name));
          const dlMeta = getDownloadedSkillMeta(name);
          data.push({
            name,
            source: 'workspace',
            status: 'workspace',
            path: path.join(skillsDir, name),
            description: meta.description ?? dlMeta?.description,
            version: meta.version ?? dlMeta?.version,
            author: meta.author ?? dlMeta?.author,
            tags: meta.tags ?? dlMeta?.tags,
            analysis: buildAnalysisSummary(name, dlMeta?.analysis),
          });
        }
      }
    } catch {
      // Skills directory may not exist yet
    }

    return reply.send({ data });
  });

  /**
   * GET /skills/quarantined - List untrusted skills
   */
  app.get('/skills/quarantined', async (_request: FastifyRequest, reply: FastifyReply) => {
    const repo = app.skillManager.getRepository();
    const allSkills = repo.getAll();
    const quarantined: Array<{ name: string; detectedAt: string; originalPath: string; reason: string }> = [];

    for (const skill of allSkills) {
      const version = repo.getLatestVersion(skill.id);
      if (version?.approval === 'quarantined') {
        quarantined.push({
          name: skill.slug,
          detectedAt: version.createdAt,
          originalPath: version.folderPath,
          reason: 'Skill not in approved list',
        });
      }
    }

    return reply.send({ quarantined });
  });

  /**
   * GET /skills/:name - Get skill detail
   */
  app.get(
    '/skills/:name',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply,
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      const manager = app.skillManager;
      const result = manager.getSkillBySlug(name);
      const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
      const skillsDir = `${agentHome}/.openclaw/workspace/skills`;

      let summary: SkillSummary;

      if (result) {
        const { skill, versions, installations } = result;
        const version = versions[0]; // Latest
        const installation = installations.find((i) => i.status === 'active')
          ?? installations[0];

        // Build detailed summary (same shape as list but with full analysis)
        const onDiskDir = path.join(skillsDir, skill.slug);
        const hasDiskPresence = fs.existsSync(onDiskDir);
        const diskMeta = hasDiskPresence ? readSkillMetadata(onDiskDir) : {};
        const dlMeta = getDownloadedSkillMeta(name);

        const isActive = installation?.status === 'active';
        const isQuarantined = version?.approval === 'quarantined';
        const isDisabled = installation?.status === 'disabled';

        let source: SkillSummary['source'];
        let status: SkillSummary['status'];

        if (isActive) { source = 'user'; status = 'active'; }
        else if (isQuarantined) { source = 'untrusted'; status = 'untrusted'; }
        else if (isDisabled) { source = 'marketplace'; status = dlMeta?.wasInstalled ? 'disabled' : 'downloaded'; }
        else if (hasDiskPresence) { source = 'workspace'; status = 'workspace'; }
        else { source = 'marketplace'; status = 'downloaded'; }

        const analysisJson = version?.analysisJson ?? dlMeta?.analysis;

        summary = {
          name: skill.slug,
          source,
          status,
          path: isActive || hasDiskPresence ? onDiskDir : '',
          publisher: skill.author,
          description: diskMeta.description ?? skill.description,
          version: diskMeta.version ?? version?.version,
          author: diskMeta.author ?? skill.author,
          tags: diskMeta.tags ?? skill.tags,
          analysis: buildFullAnalysis(name, analysisJson) as SkillSummary['analysis'],
        };
      } else {
        // Check on disk (workspace) or marketplace cache
        const onDiskDir = path.join(skillsDir, name);
        const dlMeta = getDownloadedSkillMeta(name);

        if (fs.existsSync(onDiskDir)) {
          const meta = readSkillMetadata(onDiskDir);
          summary = {
            name,
            source: 'workspace',
            status: 'workspace',
            path: onDiskDir,
            description: meta.description ?? dlMeta?.description,
            version: meta.version ?? dlMeta?.version,
            author: meta.author ?? dlMeta?.author,
            tags: meta.tags ?? dlMeta?.tags,
            analysis: buildFullAnalysis(name, dlMeta?.analysis) as SkillSummary['analysis'],
          };
        } else if (dlMeta) {
          summary = {
            name: dlMeta.slug ?? name,
            source: 'marketplace',
            status: dlMeta.wasInstalled ? 'disabled' : 'downloaded',
            description: dlMeta.description,
            path: '',
            publisher: dlMeta.author,
            version: dlMeta.version,
            author: dlMeta.author,
            tags: dlMeta.tags,
            analysis: buildFullAnalysis(name, dlMeta.analysis) as SkillSummary['analysis'],
          };
        } else {
          return reply.code(404).send({ error: `Skill "${name}" not found` });
        }
      }

      // Read content (readme) from disk
      let content = '';
      const dirToRead = summary.path || path.join(skillsDir, name);
      if (dirToRead) {
        try {
          const mdPath = findSkillMdRecursive(dirToRead);
          if (mdPath) content = fs.readFileSync(mdPath, 'utf-8');
        } catch { /* */ }
      }

      // Fall back to marketplace download cache for readme
      if (!content) {
        try {
          const localFiles = getDownloadedSkillFiles(name);
          const readmeFile = localFiles.find((f) => /readme|skill\.md/i.test(f.name));
          if (readmeFile?.content) content = readmeFile.content;
        } catch { /* */ }
      }

      // Inline images from marketplace download cache
      if (content) {
        try {
          const cachedFiles = getDownloadedSkillFiles(name);
          if (cachedFiles.length > 0) content = inlineImagesInMarkdown(content, cachedFiles);
        } catch { /* */ }
      }

      return reply.send({ data: { ...summary, content } });
    },
  );

  /**
   * POST /skills/:name/analyze - Force (re-)analysis of a skill
   */
  app.post(
    '/skills/:name/analyze',
    async (
      request: FastifyRequest<{
        Params: { name: string };
        Body: { content?: string; metadata?: Record<string, unknown> };
      }>,
      reply: FastifyReply,
    ) => {
      const { name } = request.params;
      let { content, metadata } = request.body ?? {};

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      const manager = app.skillManager;
      const repo = manager.getRepository();
      const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
      const skillsDir = `${agentHome}/.openclaw/workspace/skills`;

      // Try to find version in DB to use the library's analyzer
      const skill = repo.getBySlug(name);
      if (skill) {
        const version = repo.getLatestVersion(skill.id);
        if (version) {
          // Reset and re-analyze using the library
          try {
            // Fire-and-forget analysis
            manager.analyzer.reanalyze(version.id).then((result) => {
              emitSkillAnalyzed(name, result);
            }).catch((err) => {
              emitSkillAnalysisFailed(name, (err as Error).message);
            });
            return reply.send({ success: true, data: { status: 'pending' } });
          } catch {
            // Fall through to legacy analysis
          }
        }
      }

      // Legacy analysis path — for skills not yet in DB
      if (!content) {
        const possibleDirs = [
          path.join(skillsDir, name),
        ];

        for (const dir of possibleDirs) {
          try {
            const mdPath = findSkillMdRecursive(dir);
            if (mdPath) {
              content = fs.readFileSync(mdPath, 'utf-8');
              const parsed = parseSkillMd(content);
              if (parsed?.metadata && !metadata) {
                metadata = parsed.metadata as Record<string, unknown>;
              }
              break;
            }
          } catch {
            // Try next
          }
        }

        // Fall back to marketplace download cache
        if (!content) {
          try {
            const localFiles = getDownloadedSkillFiles(name);
            const skillFile = localFiles.find((f) => /skill\.md/i.test(f.name));
            if (skillFile?.content) {
              content = skillFile.content;
              const parsed = parseSkillMd(content);
              if (parsed?.metadata && !metadata) {
                metadata = parsed.metadata as Record<string, unknown>;
              }
            }
          } catch { /* */ }
        }

        // Third fallback: download from marketplace
        if (!content) {
          try {
            await getMarketplaceSkill(name);
            const freshFiles = getDownloadedSkillFiles(name);
            const skillFile = freshFiles.find((f) => /skill\.md/i.test(f.name));
            if (skillFile?.content) {
              content = skillFile.content;
              const parsed = parseSkillMd(content);
              if (parsed?.metadata && !metadata) {
                metadata = parsed.metadata as Record<string, unknown>;
              }
            }
          } catch { /* */ }
        }
      }

      if (!content) {
        return reply.code(404).send({ error: 'No skill content found to analyze' });
      }

      const dlMeta = getDownloadedSkillMeta(name);
      const log = request.log;

      // Run analysis asynchronously
      setImmediate(async () => {
        let completed = false;
        const safetyTimeout = setTimeout(() => {
          if (!completed) {
            log.error({ skill: name }, 'Analysis timed out');
            emitSkillAnalysisFailed(name, 'Analysis timed out');
          }
        }, 5 * 60_000);

        try {
          let vercelResult;
          if (dlMeta?.slug) {
            vercelResult = await analyzeSkillBySlug(dlMeta.slug, dlMeta.name, dlMeta.author, { noCache: true });
          } else {
            const localFiles = getDownloadedSkillFiles(name);
            if (localFiles.length > 0) {
              vercelResult = await analyzeSkillBundle(localFiles, name, undefined, { noCache: true });
            }
          }

          if (vercelResult) {
            const analysis = vercelResult.analysis;
            // Update DB if skill exists
            if (skill) {
              const version = repo.getLatestVersion(skill.id);
              if (version) {
                repo.updateAnalysis(version.id, {
                  status: analysis.status === 'complete' ? 'complete' : 'error',
                  json: analysis,
                  analyzedAt: new Date().toISOString(),
                });
              }
            }
            emitSkillAnalyzed(name, analysis);
          }
        } catch (err) {
          log.warn({ skill: name, err: (err as Error).message }, 'Analysis failed');
          emitSkillAnalysisFailed(name, (err as Error).message);
        } finally {
          completed = true;
          clearTimeout(safetyTimeout);
        }
      });

      return reply.send({ success: true, data: { status: 'pending' } });
    },
  );

  /**
   * POST /skills/:name/approve - Approve a quarantined skill
   */
  app.post(
    '/skills/:name/approve',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply,
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      try {
        await app.skillManager.approveSkill(name);
        return reply.send({ success: true, message: `Skill "${name}" approved` });
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  /**
   * DELETE /skills/:name - Reject and delete a quarantined skill
   */
  app.delete(
    '/skills/:name',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply,
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      try {
        await app.skillManager.rejectSkill(name);
        return reply.send({ success: true, message: `Skill "${name}" rejected and deleted` });
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  /**
   * POST /skills/:name/revoke - Revoke an approved skill
   */
  app.post(
    '/skills/:name/revoke',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply,
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      try {
        await app.skillManager.revokeSkill(name);
        emitSkillUninstalled(name);
        return reply.send({ success: true, message: `Skill "${name}" approval revoked` });
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  /**
   * PUT /skills/:name/toggle - Enable or disable a skill
   */
  app.put(
    '/skills/:name/toggle',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply,
    ) => {
      const { name } = request.params;
      const { shieldContext: ctx } = request;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      // AgenCo skills: delegate to integration-skills service for proper cleanup
      if (name === 'agenco') {
        try {
          const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
          const skillsDir = `${agentHome}/.openclaw/workspace/skills`;
          const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
          const { uninstallMasterSkill, uninstallIntegrationSkill } = await import('../services/integration-skills.js');
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith('agenco-')) {
              const integrationId = entry.name.slice('agenco-'.length);
              await uninstallIntegrationSkill(integrationId);
            }
          }
          await uninstallMasterSkill();
          return reply.send({ success: true, action: 'disabled', name });
        } catch (err) {
          return reply.code(500).send({ error: `Disable failed: ${(err as Error).message}` });
        }
      }
      if (name.startsWith('agenco-')) {
        const { onIntegrationDisconnected } = await import('../services/integration-skills.js');
        const integrationId = name.slice('agenco-'.length);
        try {
          await onIntegrationDisconnected(integrationId);
          return reply.send({ success: true, action: 'disabled', name });
        } catch (err) {
          return reply.code(500).send({ error: `Disable failed: ${(err as Error).message}` });
        }
      }

      try {
        const result = await app.skillManager.toggleSkill(name, {
          targetId: ctx.targetId ?? undefined,
          userUsername: ctx.userUsername ?? undefined,
        });

        if (result.action === 'disabled') {
          emitSkillUninstalled(name);
        }

        request.log.info({ skill: name, action: result.action }, 'Toggled skill');
        return reply.send({ success: true, action: result.action, name });
      } catch (err) {
        request.log.error({ skill: name, err: (err as Error).message }, 'Toggle failed');
        return reply.code(500).send({ error: `Toggle failed: ${(err as Error).message}` });
      }
    },
  );

  /**
   * POST /skills/install - Install a skill (analyze-first, passcode-protected)
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

      const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

      try {
        // Upload files to DB
        const uploadResult = app.skillManager.uploadFiles({
          name,
          slug,
          version: '0.0.0',
          author: publisher,
          files: files.map((f) => ({
            relativePath: f.name,
            content: Buffer.from(f.content, 'utf-8'),
          })),
        });

        // Approve and install
        const installation = await app.skillManager.approveSkill(slug, {
          targetId: request.shieldContext.targetId ?? undefined,
          userUsername: request.shieldContext.userUsername ?? undefined,
        });

        return reply.send({ success: true, name, installation });
      } catch (err) {
        request.log.error({ skill: name, err: (err as Error).message }, 'Install failed');
        return reply.code(500).send({
          error: `Installation failed: ${(err as Error).message}`,
        });
      }
    },
  );

  /**
   * POST /skills/:name/unblock - Unblock a quarantined skill
   */
  app.post(
    '/skills/:name/unblock',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply,
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      try {
        await app.skillManager.approveSkill(name, {
          targetId: request.shieldContext.targetId ?? undefined,
          userUsername: request.shieldContext.userUsername ?? undefined,
        });
        request.log.info({ skill: name }, 'Unblocked and installed skill');
        return reply.send({ success: true, message: `Skill "${name}" approved and installed` });
      } catch (err) {
        request.log.error({ skill: name, err: (err as Error).message }, 'Unblock install failed');
        return reply.code(500).send({ error: (err as Error).message });
      }
    },
  );

  /**
   * POST /skills/upload - Upload skill files to local cache
   */
  app.post<{
    Body: {
      name: string;
      files: MarketplaceSkillFile[];
      version?: string;
      author?: string;
      description?: string;
      tags?: string[];
    };
  }>(
    '/skills/upload',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { name, files, version, author, description, tags } = request.body ?? {} as Partial<{
        name: string;
        files: MarketplaceSkillFile[];
        version?: string;
        author?: string;
        description?: string;
        tags?: string[];
      }>;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }
      if (!Array.isArray(files) || files.length === 0) {
        return reply.code(400).send({ error: 'Files array is required' });
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

      // Parse SKILL.md if present for metadata
      let parsedDescription = description;
      let parsedVersion = version;
      const skillMdFile = files.find((f) => /skill\.md/i.test(f.name));
      if (skillMdFile) {
        try {
          const parsed = parseSkillMd(skillMdFile.content);
          if (parsed?.metadata) {
            parsedDescription = parsedDescription || (parsed.metadata as Record<string, string>).description;
            parsedVersion = parsedVersion || (parsed.metadata as Record<string, string>).version;
          }
        } catch { /* */ }
      }

      try {
        // Upload to SQLite via SkillManager
        app.skillManager.uploadFiles({
          name,
          slug,
          version: parsedVersion ?? '0.0.0',
          author: author ?? 'local',
          description: parsedDescription,
          tags,
          files: files.map((f) => ({
            relativePath: f.name,
            content: Buffer.from(f.content, 'utf-8'),
          })),
        });

        // Also store in legacy marketplace cache for backward compat
        try {
          storeDownloadedSkill(slug, {
            name,
            slug,
            author: author ?? 'local',
            version: parsedVersion ?? '0.0.0',
            description: parsedDescription ?? '',
            tags: tags ?? [],
          }, files);
        } catch { /* best-effort */ }

        request.log.info({ skill: name, slug }, 'Uploaded skill');
        return reply.send({ success: true, data: { name, slug } });
      } catch (err) {
        request.log.error({ skill: name, err: (err as Error).message }, 'Upload failed');
        return reply.code(500).send({ error: `Upload failed: ${(err as Error).message}` });
      }
    },
  );
}
