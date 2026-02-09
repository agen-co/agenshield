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
import { parseSkillMd, stripEnvFromSkillMd } from '@agenshield/sandbox';
import { injectInstallationTag } from '../services/skill-tag-injector';
import {
  listApproved,
  listUntrusted,
  approveSkill,
  rejectSkill,
  revokeSkill,
  getSkillsDir,
  addToApprovedList,
  removeFromApprovedList,
  computeSkillHash,
  updateApprovedHash,
} from '../watchers/skills';
import {
  analyzeSkill,
  getCachedAnalysis,
  setCachedAnalysis,
  clearCachedAnalysis,
} from '../services/skill-analyzer';
import {
  createSkillWrapper,
  removeSkillWrapper,
  addSkillPolicy,
  removeSkillPolicy,
  sudoMkdir,
  sudoWriteFile,
} from '../services/skill-lifecycle';
import { addSkillEntry, removeSkillEntry, syncOpenClawFromPolicies } from '../services/openclaw-config';
import {
  listDownloadedSkills,
  getDownloadedSkillFiles,
  getDownloadedSkillMeta,
  getMarketplaceSkill,
  storeDownloadedSkill,
  deleteDownloadedSkill,
  markDownloadedAsInstalled,
  inlineImagesInMarkdown,
  updateDownloadedAnalysis,
  analyzeSkillBySlug,
  analyzeSkillBundle,
} from '../services/marketplace';
import { isInstallInProgress } from './marketplace';
import { emitSkillAnalyzed, emitSkillAnalysisFailed, emitSkillUninstalled } from '../events/emitter';
import { loadConfig } from '../config/index';
import { requireAuth } from '../auth/middleware';
import {
  isBrokerAvailable,
  uninstallSkillViaBroker,
  installSkillViaBroker,
} from '../services/broker-bridge';

/** Compact analysis for list view — no full details/suggestions */
interface SkillAnalysisSummary {
  status: 'pending' | 'analyzing' | 'complete' | 'error' | 'installing';
  vulnerabilityLevel?: string;
  error?: string;
  commands?: Array<{ name: string; available: boolean }>;
  envVariables?: Array<{ name: string; required: boolean; sensitive: boolean }>;
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
  analysis?: SkillAnalysisSummary;
}

/**
 * Recursively search for SKILL.md or README.md in a directory tree.
 * Marketplace zips often nest files in subdirs (e.g., latest/SKILL.md).
 * Returns the absolute path to the first match, or null if not found.
 */
function findSkillMdRecursive(dir: string, depth = 0): string | null {
  if (depth > 3) return null; // don't descend too deep
  try {
    // Check root first
    for (const name of ['SKILL.md', 'skill.md', 'README.md', 'readme.md']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    // Check subdirectories
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

function readSkillDescription(skillDir: string): string | undefined {
  return readSkillMetadata(skillDir).description;
}

/** Build compact SkillAnalysisSummary for frontend consumption.
 * Returns `installing` status when an install is in progress for this skill.
 * Accepts any analysis-like object (SkillAnalysis or marketplace analysis). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAnalysisSummary(name: string, rawAnalysis?: any): SkillAnalysisSummary | undefined {
  if (isInstallInProgress(name)) {
    return { status: 'installing' };
  }
  if (!rawAnalysis || !['complete', 'pending', 'analyzing', 'error'].includes(rawAnalysis.status)) {
    return undefined;
  }
  return {
    status: rawAnalysis.status as SkillAnalysisSummary['status'],
    vulnerabilityLevel: rawAnalysis.status === 'complete' ? rawAnalysis.vulnerability?.level : undefined,
    error: rawAnalysis.status === 'error' ? rawAnalysis.error : undefined,
    commands: rawAnalysis.status === 'complete' && Array.isArray(rawAnalysis.commands)
      ? rawAnalysis.commands.map((c: { name: string; available: boolean }) => ({ name: c.name, available: c.available }))
      : undefined,
    envVariables: rawAnalysis.status === 'complete' && Array.isArray(rawAnalysis.envVariables)
      ? rawAnalysis.envVariables.map((e: { name: string; required: boolean; sensitive: boolean }) => ({ name: e.name, required: e.required, sensitive: e.sensitive }))
      : undefined,
  };
}

/** Full analysis for detail view — includes all rich fields from Vercel analyzer */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFullAnalysis(name: string, rawAnalysis?: any): object | undefined {
  if (isInstallInProgress(name)) {
    return { status: 'installing' };
  }
  if (!rawAnalysis || !['complete', 'pending', 'analyzing', 'error'].includes(rawAnalysis.status)) {
    return undefined;
  }
  return {
    status: rawAnalysis.status,
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
 * Register skills management routes
 */
export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /skills - List all skills as normalized SkillSummary[]
   */
  app.get('/skills', async (_request: FastifyRequest, reply: FastifyReply) => {
    const approved = listApproved();
    const untrusted = listUntrusted();
    const skillsDir = getSkillsDir();

    // Scan the skills directory on disk to find workspace skills
    const approvedNames = new Set(approved.map((a) => a.name));
    const untrustedNames = new Set(untrusted.map((u) => u.name));
    let onDiskNames: string[] = [];
    if (skillsDir) {
      try {
        onDiskNames = fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        // Skills directory may not exist yet
      }
    }
    const workspaceNames = onDiskNames.filter(
      (n) => !approvedNames.has(n) && !untrustedNames.has(n)
    );

    const data: SkillSummary[] = [
      // Approved → active (with metadata from SKILL.md + cached analysis)
      ...approved.map((a) => {
        const meta = skillsDir ? readSkillMetadata(path.join(skillsDir, a.name)) : {};
        const cached = getCachedAnalysis(a.name);
        const dlMeta = getDownloadedSkillMeta(a.name);
        return {
          name: a.name,
          source: 'user' as const,
          status: 'active' as const,
          path: path.join(skillsDir ?? '', a.name),
          publisher: a.publisher,
          description: meta.description,
          version: meta.version,
          author: meta.author ?? a.publisher,
          tags: meta.tags ?? dlMeta?.tags,
          analysis: buildAnalysisSummary(a.name, dlMeta?.analysis || cached),
        };
      }),
      // Untrusted: detected but not approved, stored in marketplace cache
      ...untrusted.map((u) => {
        const dlMeta = getDownloadedSkillMeta(u.name);
        const cached = getCachedAnalysis(u.name);
        return {
          name: u.name,
          source: 'untrusted' as const,
          status: 'untrusted' as const,
          path: '',
          description: dlMeta?.description,
          version: dlMeta?.version,
          author: dlMeta?.author,
          tags: dlMeta?.tags,
          analysis: buildAnalysisSummary(u.name, dlMeta?.analysis || cached),
        };
      }),
      // Workspace: on disk but not approved or untrusted
      ...workspaceNames.map((name) => {
        const meta = skillsDir ? readSkillMetadata(path.join(skillsDir, name)) : {};
        const dlMeta = getDownloadedSkillMeta(name);
        const cached = getCachedAnalysis(name);
        return {
          name,
          source: 'workspace' as const,
          status: 'workspace' as const,
          path: path.join(skillsDir ?? '', name),
          description: meta.description ?? dlMeta?.description,
          version: meta.version ?? dlMeta?.version,
          author: meta.author ?? dlMeta?.author,
          tags: meta.tags ?? dlMeta?.tags,
          analysis: buildAnalysisSummary(name, dlMeta?.analysis || cached),
        };
      }),
      // Disabled: previously installed marketplace skills that are no longer active
      ...(() => {
        const allKnown = new Set([
          ...approvedNames,
          ...untrustedNames,
          ...workspaceNames,
        ]);
        return listDownloadedSkills()
          .filter((d) => d.wasInstalled && !allKnown.has(d.slug) && !allKnown.has(d.name))
          .map((d) => {
            const cached = getCachedAnalysis(d.slug) || getCachedAnalysis(d.name);
            return {
              name: d.slug,
              source: 'marketplace' as const,
              status: 'disabled' as const,
              path: '',
              publisher: d.author,
              description: d.description,
              version: d.version,
              author: d.author,
              tags: d.tags,
              analysis: buildAnalysisSummary(d.slug, d.analysis || cached),
            };
          });
      })(),
    ];

    return reply.send({ data });
  });

  /**
   * GET /skills/quarantined - List untrusted skills (backward-compatible endpoint name)
   */
  app.get('/skills/quarantined', async (_request: FastifyRequest, reply: FastifyReply) => {
    const untrusted = listUntrusted();
    return reply.send({ quarantined: untrusted });
  });

  /**
   * GET /skills/:name - Get skill detail.
   * Returns the same SkillSummary shape as GET /skills items, plus `content` (readme).
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

      const approved = listApproved();
      const untrusted = listUntrusted();
      const skillsDir = getSkillsDir();

      const entry = approved.find((s) => s.name === name);
      const uEntry = untrusted.find((u) => u.name === name);
      const dlMeta = getDownloadedSkillMeta(name);

      // Check if on disk but not approved/untrusted (workspace)
      let isWorkspace = false;
      if (!entry && !uEntry && skillsDir) {
        try { isWorkspace = fs.existsSync(path.join(skillsDir, name)); } catch { /* */ }
      }

      // Build SkillSummary — same shape as GET /skills items
      let summary: SkillSummary;

      if (uEntry) {
        summary = {
          name,
          source: 'untrusted',
          status: 'untrusted',
          path: '',
          description: dlMeta?.description,
          version: dlMeta?.version,
          author: dlMeta?.author,
          tags: dlMeta?.tags,
          analysis: buildFullAnalysis(name, dlMeta?.analysis || getCachedAnalysis(name)) as SkillSummary['analysis'],
        };
      } else if (entry) {
        const meta = skillsDir ? readSkillMetadata(path.join(skillsDir, name)) : {};
        const cached = getCachedAnalysis(name);
        summary = {
          name,
          source: 'user',
          status: 'active',
          path: skillsDir ? path.join(skillsDir, name) : '',
          publisher: entry.publisher,
          description: meta.description,
          version: meta.version,
          author: meta.author ?? entry.publisher,
          tags: meta.tags ?? dlMeta?.tags,
          analysis: buildFullAnalysis(name, dlMeta?.analysis || cached) as SkillSummary['analysis'],
        };
      } else if (isWorkspace) {
        const meta = skillsDir ? readSkillMetadata(path.join(skillsDir, name)) : {};
        const wsDlMeta = getDownloadedSkillMeta(name);
        summary = {
          name,
          source: 'workspace',
          status: 'workspace',
          path: skillsDir ? path.join(skillsDir, name) : '',
          description: meta.description ?? wsDlMeta?.description,
          version: meta.version ?? wsDlMeta?.version,
          author: meta.author ?? wsDlMeta?.author,
          tags: meta.tags ?? wsDlMeta?.tags,
          analysis: buildFullAnalysis(name, wsDlMeta?.analysis || getCachedAnalysis(name)) as SkillSummary['analysis'],
        };
      } else if (dlMeta) {
        const cached = getCachedAnalysis(name);
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
          analysis: buildFullAnalysis(name, dlMeta.analysis || cached) as SkillSummary['analysis'],
        };
      } else {
        return reply.code(404).send({ error: `Skill "${name}" not found` });
      }

      // Read content (readme) from disk
      let content = '';
      const dirToRead = summary.path || (skillsDir ? path.join(skillsDir, name) : '');
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
          const readmeFile = localFiles.find(f => /readme|skill\.md/i.test(f.name));
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
    }
  );

  /**
   * POST /skills/:name/analyze - Force (re-)analysis of a skill.
   * Reads content from request body, disk, or marketplace cache.
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
      let { content, metadata } = request.body ?? {};

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      // Clear existing cache (both local and marketplace download)
      clearCachedAnalysis(name);
      try { updateDownloadedAnalysis(name, undefined as unknown as Parameters<typeof updateDownloadedAnalysis>[1]); } catch { /* best-effort */ }

      // If no content provided, try to read from disk or marketplace cache
      if (!content) {
        const skillsDir = getSkillsDir();
        const possibleDirs = [
          skillsDir ? path.join(skillsDir, name) : null,
        ].filter(Boolean) as string[];

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
            const skillFile = localFiles.find(f => /skill\.md/i.test(f.name));
            if (skillFile?.content) {
              content = skillFile.content;
              const parsed = parseSkillMd(content);
              if (parsed?.metadata && !metadata) {
                metadata = parsed.metadata as Record<string, unknown>;
              }
            }
          } catch {
            // Best-effort
          }
        }

        // Third fallback: download from marketplace (for search results not yet cached)
        if (!content) {
          try {
            await getMarketplaceSkill(name); // downloads ZIP → stores in cache
            const freshFiles = getDownloadedSkillFiles(name);
            const skillFile = freshFiles.find(f => /skill\.md/i.test(f.name));
            if (skillFile?.content) {
              content = skillFile.content;
              const parsed = parseSkillMd(content);
              if (parsed?.metadata && !metadata) {
                metadata = parsed.metadata as Record<string, unknown>;
              }
            }
          } catch { /* Continue to 404 */ }
        }
      }

      if (!content) {
        return reply.code(404).send({ error: 'No skill content found to analyze' });
      }

      // Save "pending" status immediately so GET /skills returns it
      setCachedAnalysis(name, {
        status: 'pending',
        analyzerId: 'agenshield',
        commands: [],
      });

      // Determine if this is a downloaded marketplace skill (has a slug)
      const dlMeta = getDownloadedSkillMeta(name);

      // Run analysis asynchronously — Vercel analysis preferred for comprehensive results
      setImmediate(async () => {
        let completed = false;
        // Safety net: if analysis hasn't completed in 5 minutes, mark as error
        const safetyTimeout = setTimeout(() => {
          if (!completed) {
            console.error(`[Skills] Analysis timed out for ${name}, marking as error`);
            setCachedAnalysis(name, {
              status: 'error',
              analyzerId: 'agenshield',
              commands: [],
              error: 'Analysis timed out',
            });
            emitSkillAnalysisFailed(name, 'Analysis timed out');
          }
        }, 5 * 60_000);

        try {
          // Try Vercel analysis first (AI-powered, comprehensive)
          let vercelResult;
          if (dlMeta?.slug) {
            // Marketplace skill — analyze by slug, bypassing Vercel cache
            vercelResult = await analyzeSkillBySlug(dlMeta.slug, dlMeta.name, dlMeta.author, { noCache: true });
          } else {
            // Local skill — send files to Vercel for analysis
            const localFiles = getDownloadedSkillFiles(name);
            if (localFiles.length > 0) {
              vercelResult = await analyzeSkillBundle(localFiles, name, undefined, { noCache: true });
            }
          }

          if (vercelResult) {
            // Use Vercel analysis result (more comprehensive)
            const analysis = vercelResult.analysis;
            setCachedAnalysis(name, {
              status: analysis.status === 'complete' ? 'complete' : 'error',
              analyzerId: 'agenshield',
              commands: analysis.commands?.map(c => ({
                name: c.name,
                source: c.source as 'metadata' | 'analysis',
                available: c.available,
                required: c.required,
              })) ?? [],
              vulnerability: analysis.vulnerability,
              envVariables: analysis.envVariables,
              runtimeRequirements: analysis.runtimeRequirements,
              installationSteps: analysis.installationSteps,
              runCommands: analysis.runCommands,
              securityFindings: analysis.securityFindings,
              mcpSpecificRisks: analysis.mcpSpecificRisks,
              error: analysis.status === 'error' ? 'Vercel analysis returned error' : undefined,
            });
            // Also update the downloaded metadata
            if (dlMeta) {
              try { updateDownloadedAnalysis(name, analysis); } catch { /* best-effort */ }
            }
            console.log(`[Skills] Vercel analysis complete for: ${name}`);
            emitSkillAnalyzed(name, getCachedAnalysis(name));
          } else {
            // Fallback to local analysis
            analyzeSkill(name, content, metadata);
            console.log(`[Skills] Local analysis complete for: ${name}`);
            emitSkillAnalyzed(name, getCachedAnalysis(name));
          }
        } catch (err) {
          // Fallback to local analysis on Vercel failure
          console.warn(`[Skills] Vercel analysis failed for ${name}, falling back to local:`, (err as Error).message);
          try {
            analyzeSkill(name, content, metadata);
            console.log(`[Skills] Local analysis complete for: ${name}`);
            emitSkillAnalyzed(name, getCachedAnalysis(name));
          } catch (localErr) {
            console.error(`[Skills] All analysis failed for ${name}:`, (localErr as Error).message);
            setCachedAnalysis(name, {
              status: 'error',
              analyzerId: 'agenshield',
              commands: [],
              error: (localErr as Error).message,
            });
            emitSkillAnalysisFailed(name, (localErr as Error).message);
          }
        } finally {
          completed = true;
          clearTimeout(safetyTimeout);
        }
      });

      return reply.send({ success: true, data: { status: 'pending' } });
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

      emitSkillUninstalled(name);
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
      const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';
      const skillDir = path.join(skillsDir, name);
      const isInstalled = fs.existsSync(skillDir);

      if (isInstalled) {
        // DISABLE: Remove from workspace via broker (handles root-owned dirs)
        try {
          const brokerAvailable = await isBrokerAvailable();
          if (brokerAvailable) {
            await uninstallSkillViaBroker(name, {
              removeWrapper: true,
              agentHome,
            });
          } else {
            // Fallback: direct fs removal (may fail for root-owned dirs)
            fs.rmSync(skillDir, { recursive: true, force: true });
            removeSkillWrapper(name, binDir);
          }
          removeSkillEntry(name);
          removeSkillPolicy(name);
          syncOpenClawFromPolicies(loadConfig().policies);
          removeFromApprovedList(name);
          // Preserve marketplace cache for re-enable; mark as previously installed
          try { markDownloadedAsInstalled(name); } catch { /* best-effort */ }

          console.log(`[Skills] Disabled marketplace skill: ${name}`);
          emitSkillUninstalled(name);
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
          // Pre-approve with marketplace slug link
          addToApprovedList(name, meta.author, undefined, meta.slug);

          // Prepare files: strip env vars and inject installation tag
          const taggedFiles = await Promise.all(files.map(async (f) => {
            let content = f.content;
            if (/SKILL\.md$/i.test(f.name)) {
              content = stripEnvFromSkillMd(content);
              content = await injectInstallationTag(content);
            }
            return { name: f.name, content, type: f.type };
          }));

          // Install via broker if available (handles mkdir, write, chown, wrapper)
          const brokerAvailable = await isBrokerAvailable();
          if (brokerAvailable) {
            const brokerResult = await installSkillViaBroker(
              name,
              taggedFiles.map((f) => ({ name: f.name, content: f.content })),
              { createWrapper: true, agentHome, socketGroup }
            );
            if (!brokerResult.installed) {
              throw new Error('Broker failed to install skill files');
            }
            if (brokerResult.warnings?.length) {
              for (const warning of brokerResult.warnings) {
                console.warn(`[Skills] Enable warning for ${name}: ${warning}`);
              }
            }
          } else {
            // Fallback: direct fs operations
            fs.mkdirSync(skillDir, { recursive: true });
            for (const file of taggedFiles) {
              const filePath = path.join(skillDir, file.name);
              fs.mkdirSync(path.dirname(filePath), { recursive: true });
              fs.writeFileSync(filePath, file.content, 'utf-8');
            }
            try {
              execSync(`chown -R root:${socketGroup} "${skillDir}"`, { stdio: 'pipe' });
              execSync(`chmod -R a+rX,go-w "${skillDir}"`, { stdio: 'pipe' });
            } catch {
              // May fail if not root
            }
            createSkillWrapper(name, binDir);
          }

          // Config + policy
          addSkillEntry(name);
          addSkillPolicy(name);
          syncOpenClawFromPolicies(loadConfig().policies);

          // Record integrity hash
          const hash = computeSkillHash(skillDir);
          if (hash) updateApprovedHash(name, hash);

          // Mark marketplace cache as installed (preserves metadata for re-enable)
          try { markDownloadedAsInstalled(name); } catch { /* best-effort */ }

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
      const agentUsername = path.basename(agentHome);
      const binDir = path.join(agentHome, 'bin');
      const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';
      const skillDir = path.join(skillsDir, name);

      try {
        // 3. Pre-approve to prevent watcher quarantine race
        addToApprovedList(name, publisher);

        // 4. Prepare files: strip env vars and inject installation tag
        const taggedFiles = await Promise.all(files.map(async (f) => {
          let content = f.content;
          if (/SKILL\.md$/i.test(f.name)) {
            content = stripEnvFromSkillMd(content);
            content = await injectInstallationTag(content);
          }
          return { name: f.name, content };
        }));

        // 5. Write files to $AGENT_HOME/.openclaw/skills/<name>/
        sudoMkdir(skillDir, agentUsername);
        for (const file of taggedFiles) {
          const filePath = path.join(skillDir, file.name);
          sudoMkdir(path.dirname(filePath), agentUsername);
          sudoWriteFile(filePath, file.content, agentUsername);
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

        // 7. Update openclaw.json + policy
        addSkillEntry(name);
        addSkillPolicy(name);
        syncOpenClawFromPolicies(loadConfig().policies);

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

  /**
   * POST /skills/:name/unblock - Unblock a quarantined skill.
   * Approves the skill (moves from quarantine → skills dir) and sets up
   * wrapper, policy, and config entry so it becomes active.
   */
  app.post(
    '/skills/:name/unblock',
    async (
      request: FastifyRequest<{ Params: { name: string } }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;

      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'Skill name is required' });
      }

      // Verify skill is actually untrusted (in marketplace cache, not approved)
      const untrustedList = listUntrusted();
      const uEntry = untrustedList.find((u) => u.name === name);
      if (!uEntry) {
        return reply.code(404).send({ error: `Skill "${name}" is not in untrusted state` });
      }

      // Get files from marketplace cache
      const meta = getDownloadedSkillMeta(name);
      if (!meta) {
        return reply.code(404).send({ error: 'Skill not found in marketplace cache' });
      }

      const files = getDownloadedSkillFiles(name);
      if (files.length === 0) {
        return reply.code(404).send({ error: 'No files in marketplace cache for this skill' });
      }

      // Install from marketplace cache (same flow as toggle-enable)
      try {
        const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
        const binDir = path.join(agentHome, 'bin');
        const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';
        const skillDir = path.join(getSkillsDir(), name);

        // Pre-approve with marketplace slug link
        addToApprovedList(name, meta.author, undefined, meta.slug);

        // Prepare files: strip env vars and inject installation tag
        const taggedFiles = await Promise.all(files.map(async (f) => {
          let content = f.content;
          if (/SKILL\.md$/i.test(f.name)) {
            content = stripEnvFromSkillMd(content);
            content = await injectInstallationTag(content);
          }
          return { name: f.name, content, type: f.type };
        }));

        // Install via broker if available
        const brokerAvailable = await isBrokerAvailable();
        if (brokerAvailable) {
          const brokerResult = await installSkillViaBroker(
            name,
            taggedFiles.map((f) => ({ name: f.name, content: f.content })),
            { createWrapper: true, agentHome, socketGroup }
          );
          if (!brokerResult.installed) {
            throw new Error('Broker failed to install skill files');
          }
          if (brokerResult.warnings?.length) {
            for (const warning of brokerResult.warnings) {
              console.warn(`[Skills] Unblock warning for ${name}: ${warning}`);
            }
          }
        } else {
          // Fallback: direct fs operations
          fs.mkdirSync(skillDir, { recursive: true });
          for (const file of taggedFiles) {
            const filePath = path.join(skillDir, file.name);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, file.content, 'utf-8');
          }
          try {
            execSync(`chown -R root:${socketGroup} "${skillDir}"`, { stdio: 'pipe' });
            execSync(`chmod -R a+rX,go-w "${skillDir}"`, { stdio: 'pipe' });
          } catch {
            // May fail if not root
          }
          createSkillWrapper(name, binDir);
        }

        addSkillEntry(name);
        addSkillPolicy(name);
        syncOpenClawFromPolicies(loadConfig().policies);

        // Record integrity hash
        const unblockHash = computeSkillHash(path.join(getSkillsDir(), name));
        if (unblockHash) updateApprovedHash(name, unblockHash);

        // Mark marketplace cache as installed (preserves metadata for re-enable)
        try { markDownloadedAsInstalled(name); } catch { /* best-effort */ }

        console.log(`[Skills] Unblocked and installed skill: ${name}`);
        return reply.send({ success: true, message: `Skill "${name}" approved and installed` });
      } catch (err) {
        // Cleanup on failure
        try { removeFromApprovedList(name); } catch { /* */ }
        console.error('[Skills] Unblock install failed:', (err as Error).message);
        return reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  /**
   * POST /skills/upload - Upload skill files to local marketplace cache.
   * Accepts JSON body: { name, files: MarketplaceSkillFile[], version?, author?, description?, tags? }
   * Stores in ~/.agenshield/marketplace/<name>/ for later analysis + install.
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
        } catch {
          // Best-effort
        }
      }

      try {
        storeDownloadedSkill(slug, {
          name,
          slug,
          author: author ?? 'local',
          version: parsedVersion ?? '0.0.0',
          description: parsedDescription ?? '',
          tags: tags ?? [],
        }, files);

        console.log(`[Skills] Uploaded skill to local cache: ${slug}`);
        return reply.send({ success: true, data: { name, slug } });
      } catch (err) {
        console.error('[Skills] Upload failed:', (err as Error).message);
        return reply.code(500).send({ error: `Upload failed: ${(err as Error).message}` });
      }
    }
  );
}

