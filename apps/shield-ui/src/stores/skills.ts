/**
 * Centralized valtio store for all skills state.
 *
 * Single-list architecture: all skill data lives in `skills[]`.
 * `selectedId` points into the list — no separate selectedSkill copy.
 * Detail fetches update entries in-place via `upsertSkill`.
 */

import { proxy } from 'valtio';
import type { EnvVariableDetail } from '@agenshield/ipc';
import {
  searchSkillsVercel,
  fetchSkillBySlugVercel,
  analyzeSkillDaemon,
  analyzeSkillVercel,
  fetchDaemonSkills,
  fetchDaemonSkillDetail,
  fetchMarketplaceSkillDetail,
  installSkillDaemon,
  uninstallSkillDaemon,
  unblockSkillDaemon,
  deleteSkillDaemon,
  uploadSkillZipDaemon,
  type DaemonSkillSummary,
  type SearchSkillResult,
  type AnalysisResult,
} from './skills-api';
import { notify } from './notifications';
import { queryClient } from '../api/query-client';
import { queryKeys } from '../api/hooks';
import { api } from '../api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SkillOrigin = 'installed' | 'search' | 'local' | 'blocked' | 'downloaded' | 'untrusted';

export type SkillActionState =
  | 'not_analyzed'
  | 'analyzing'
  | 'analysis_failed'
  | 'analyzed'
  | 'installing'
  | 'installed'
  | 'blocked';

export interface UnifiedSkill {
  name: string;
  slug: string;
  description: string;
  author: string;
  version: string;
  origin: SkillOrigin;
  actionState: SkillActionState;
  installationId?: string;
  analysis?: AnalysisResult | null;
  analysisStatus?: 'pending' | 'complete' | 'error' | null;
  tags?: string[];
  installs?: number;
  path?: string;
  source?: string;
  sha?: string;
  envVariables?: EnvVariableDetail[];
  readme?: string;
  /** True when full detail has been fetched (daemon or marketplace) */
  detailLoaded?: boolean;
  /** Registry source from search API (clawhub, openclaw, local) */
  registrySource?: 'clawhub' | 'openclaw' | 'local';
  /** Full registry path for openclaw skills (e.g. "openclaw/owner/skill") */
  registryPath?: string;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export interface SkillsStore {
  skills: UnifiedSkill[];
  /** Points into skills[] — installationId for installed, slug for others */
  selectedId: string | null;
  searchQuery: string;
  searchLoading: boolean;
  searchError: string | null;
  installedLoading: boolean;
  selectedLoading: boolean;
  uploading: boolean;
  uploadError: string | null;
}

export const skillsStore = proxy<SkillsStore>({
  skills: [],
  selectedId: null,
  searchQuery: '',
  searchLoading: false,
  searchError: null,
  installedLoading: false,
  selectedLoading: false,
  uploading: false,
  uploadError: null,
});

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

function mapDaemonSkill(s: DaemonSkillSummary): UnifiedSkill {
  const isBlocked = s.status === 'quarantined' || s.status === 'blocked';
  const isDownloaded = s.status === 'downloaded' || s.status === 'disabled';
  const isUntrusted = s.status === 'untrusted';

  let origin: SkillOrigin;
  let actionState: SkillActionState;

  const isAnalyzing = s.analysis?.status === 'pending' || s.analysis?.status === 'analyzing';
  const isInstalling = s.analysis?.status === 'installing';
  const isError = s.analysis?.status === 'error';
  const isAnalysisComplete = s.analysis?.status === 'complete';

  if (isUntrusted) {
    origin = 'untrusted';
    actionState = isAnalyzing ? 'analyzing'
      : isInstalling ? 'installing'
      : isError ? 'analysis_failed'
      : isAnalysisComplete ? 'analyzed'
      : 'not_analyzed';
  } else if (isBlocked) {
    origin = 'blocked';
    actionState = isAnalyzing ? 'analyzing' : isInstalling ? 'installing' : isError ? 'analysis_failed' : 'blocked';
  } else if (isDownloaded) {
    origin = 'downloaded';
    actionState = isAnalyzing ? 'analyzing' : isInstalling ? 'installing' : isError ? 'analysis_failed' : 'analyzed';
  } else {
    origin = 'installed';
    actionState = isAnalyzing ? 'analyzing' : isInstalling ? 'installing' : isError ? 'analysis_failed' : 'installed';
  }

  // Map analysis from daemon into the shape the UI expects.
  // Detail endpoint returns full analysis (vulnerability object, securityFindings, etc.);
  // list endpoint returns compact summary (vulnerabilityLevel string only).
  let analysis: AnalysisResult | undefined;
  if (s.analysis?.status === 'complete') {
    analysis = {
      status: 'complete',
      vulnerability: s.analysis.vulnerability ?? {
        level: s.analysis.vulnerabilityLevel ?? 'safe',
        details: [],
      },
      commands: (s.analysis.commands ?? []).map((c) => ({
        name: c.name,
        source: c.source ?? 'metadata',
        available: c.available,
        required: c.required ?? false,
      })),
      envVariables: s.analysis.envVariables?.map((e) => ({
        name: e.name,
        required: e.required,
        purpose: e.purpose ?? '',
        sensitive: e.sensitive,
      })),
      securityFindings: s.analysis.securityFindings as AnalysisResult['securityFindings'],
      mcpSpecificRisks: s.analysis.mcpSpecificRisks as AnalysisResult['mcpSpecificRisks'],
    };
  } else if (s.analysis?.status === 'error') {
    analysis = {
      status: 'error',
      vulnerability: {
        level: 'safe',
        details: s.analysis.error ? [`Analysis failed: ${s.analysis.error}`] : ['Analysis failed'],
      },
      commands: [],
    };
  }

  return {
    name: s.name,
    slug: slugify(s.name),
    description: s.description ?? '',
    author: s.author ?? s.publisher ?? '',
    version: s.version ?? '',
    origin,
    actionState,
    installationId: s.installationId,
    tags: s.tags ?? [],
    path: s.path,
    source: s.source,
    sha: s.sha,
    analysis,
    envVariables: analysis?.envVariables,
  };
}

function mapSearchResult(s: SearchSkillResult): UnifiedSkill {
  let analysis: AnalysisResult | undefined;
  if (s.analysisStatus === 'complete' && s.analysis != null) {
    analysis = {
      status: 'complete',
      vulnerability: s.analysis.vulnerability,
      commands: (s.analysis.commands ?? []).map((c) => ({
        name: c.name,
        source: c.source,
        available: c.available,
        required: c.required,
      })),
      envVariables: s.analysis.envVariables?.map((e) => ({
        name: e.name,
        required: e.required,
        purpose: e.purpose,
        sensitive: e.sensitive,
      })),
      securityFindings: s.analysis.securityFindings as AnalysisResult['securityFindings'],
      mcpSpecificRisks: s.analysis.mcpSpecificRisks as AnalysisResult['mcpSpecificRisks'],
    };
  }

  return {
    name: s.name,
    slug: s.slug,
    description: s.description,
    author: s.author,
    version: s.version,
    origin: 'search',
    actionState: s.analysisStatus === 'complete' ? 'analyzed' : 'not_analyzed',
    analysis,
    analysisStatus: s.analysisStatus,
    tags: s.tags,
    installs: s.installs,
    envVariables: analysis?.envVariables,
    registrySource: s.source,
    registryPath: s.path,
  };
}

/**
 * Merge installed and search skill arrays.
 * Daemon skills take priority over search results with the same slug.
 *
 * Sort order:
 *  - No search: installed (by name) → downloaded (by name) → blocked → local → search
 *  - Searching: all sorted by name
 */
function matchesQuery(skill: UnifiedSkill, query: string): boolean {
  const q = query.toLowerCase();
  return (
    skill.name.toLowerCase().includes(q) ||
    skill.slug.toLowerCase().includes(q) ||
    skill.description.toLowerCase().includes(q) ||
    skill.author.toLowerCase().includes(q) ||
    (skill.tags ?? []).some((t) => t.toLowerCase().includes(q))
  );
}

function mergeSkills(installed: UnifiedSkill[], search: UnifiedSkill[]): UnifiedSkill[] {
  const bySlug = new Map<string, UnifiedSkill>();
  const isSearching = search.length > 0;
  const query = skillsStore.searchQuery;

  // Installed/blocked/downloaded — filter by query when searching
  for (const skill of installed) {
    if (isSearching && query.length >= 2 && !matchesQuery(skill, query)) continue;
    bySlug.set(skill.slug, skill);
  }

  // Search results — only add if not already present from daemon
  for (const skill of search) {
    if (!bySlug.has(skill.slug)) {
      bySlug.set(skill.slug, skill);
    }
  }

  if (isSearching) {
    // When searching: preserve relevance order from the API response.
    // Installed matches appear first, then search results in their original order.
    return Array.from(bySlug.values());
  }

  // No search: group by origin, then sort by name within each group
  const groupOrder: Record<SkillOrigin, number> = {
    installed: 0,
    downloaded: 1,
    blocked: 2,
    local: 3,
    search: 4,
    untrusted: 5,
  };

  return Array.from(bySlug.values()).sort((a, b) => {
    const groupDiff = groupOrder[a.origin] - groupOrder[b.origin];
    if (groupDiff !== 0) return groupDiff;
    return a.name.localeCompare(b.name);
  });
}

function findSkill(id: string): UnifiedSkill | undefined {
  return skillsStore.skills.find((s) => s.installationId === id || s.slug === id || s.name === id);
}

function updateSkill(id: string, updates: Partial<UnifiedSkill>): void {
  const idx = skillsStore.skills.findIndex((s) => s.installationId === id || s.slug === id || s.name === id);
  if (idx !== -1) {
    Object.assign(skillsStore.skills[idx], updates);
  }
}

/** Insert or merge a skill entry in the list (preserves existing fields like readme, analysis) */
function upsertSkill(slugOrName: string, skill: UnifiedSkill): void {
  const idx = skillsStore.skills.findIndex((s) => s.slug === slugOrName || s.name === slugOrName);
  if (idx >= 0) {
    Object.assign(skillsStore.skills[idx], skill);
  } else {
    skillsStore.skills.push(skill);
  }
}

/* ------------------------------------------------------------------ */
/*  Analysis timeout safety net                                        */
/* ------------------------------------------------------------------ */

const ANALYSIS_TIMEOUT = 10 * 60_000; // 10 minutes
const analysisTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function startAnalysisTimeout(slug: string): void {
  clearAnalysisTimeout(slug);
  const timer = setTimeout(() => {
    analysisTimeouts.delete(slug);
    const skill = findSkill(slug);
    if (skill?.actionState === 'analyzing') {
      updateSkill(slug, { actionState: 'analysis_failed' });
      notify.error(`Analysis timed out for "${slug}"`);
    }
  }, ANALYSIS_TIMEOUT);
  analysisTimeouts.set(slug, timer);
}

function clearAnalysisTimeout(slug: string): void {
  const timer = analysisTimeouts.get(slug);
  if (timer) {
    clearTimeout(timer);
    analysisTimeouts.delete(slug);
  }
}

/* ------------------------------------------------------------------ */
/*  Actions                                                            */
/* ------------------------------------------------------------------ */

let installedSkillsCache: UnifiedSkill[] = [];
let searchSkillsCache: UnifiedSkill[] = [];

export async function fetchInstalledSkills(): Promise<void> {
  skillsStore.installedLoading = true;
  try {
    const daemonSkills = await fetchDaemonSkills();
    const newSkills = daemonSkills.map(mapDaemonSkill);

    // Snapshot detail-loaded skills BEFORE merge replaces the list.
    // These may have been fetched via fetchSkillDetail (e.g. direct URL navigation)
    // and might not appear in the daemon list response.
    const previousDetailSkills = skillsStore.skills.filter(s => s.detailLoaded);

    // Preserve detail data from existing entries (readme, detailLoaded, full analysis)
    for (const newSkill of newSkills) {
      const existing = previousDetailSkills.find((s) => s.slug === newSkill.slug);
      if (existing) {
        newSkill.readme = existing.readme;
        newSkill.detailLoaded = true;
        // Preserve rich analysis from detail fetch (list endpoint returns compact summary)
        if (existing.analysis) {
          newSkill.analysis = existing.analysis;
          newSkill.envVariables = existing.envVariables;
        }
      }
    }

    installedSkillsCache = newSkills;
    skillsStore.skills = mergeSkills(installedSkillsCache, searchSkillsCache);

    // Re-insert detail-loaded skills that aren't in the merged result.
    // This prevents the race condition where fetchSkillDetail completes first,
    // then fetchInstalledSkills overwrites the list without the individually-fetched skill.
    for (const detailSkill of previousDetailSkills) {
      if (!skillsStore.skills.some(s => s.slug === detailSkill.slug)) {
        skillsStore.skills.push(detailSkill);
      }
    }

    // Skills reported as 'analyzing' but WITHOUT an active client-side timeout
    // were NOT started in this browser session — treat as stale / timed-out.
    // If the daemon is genuinely still working, the SSE event will correct the state.
    for (const skill of skillsStore.skills) {
      if (skill.actionState === 'analyzing' && !analysisTimeouts.has(skill.slug)) {
        updateSkill(skill.slug, { actionState: 'analysis_failed' });
      }
    }
    // Clear timeouts for skills that resolved while we were disconnected
    for (const [slug] of analysisTimeouts) {
      const skill = skillsStore.skills.find(s => s.slug === slug);
      if (!skill || skill.actionState !== 'analyzing') {
        clearAnalysisTimeout(slug);
      }
    }
  } catch {
    // Keep existing data on error
  } finally {
    skillsStore.installedLoading = false;
  }
}

export async function searchSkills(query: string): Promise<void> {
  skillsStore.searchQuery = query;

  if (query.length < 2) {
    searchSkillsCache = [];
    skillsStore.skills = mergeSkills(installedSkillsCache, []);
    skillsStore.searchError = null;
    return;
  }

  skillsStore.searchLoading = true;
  skillsStore.searchError = null;

  try {
    const results = await searchSkillsVercel(query);
    searchSkillsCache = results.map(mapSearchResult);
    skillsStore.skills = mergeSkills(installedSkillsCache, searchSkillsCache);
  } catch (err) {
    skillsStore.searchError = err instanceof Error ? err.message : 'Search failed';
  } finally {
    skillsStore.searchLoading = false;
  }
}

export async function analyzeSkill(slugOrName: string): Promise<void> {
  const skill = findSkill(slugOrName);
  const slug = skill?.slug ?? slugOrName;

  // Keep existing analysis visible while re-analysis is in progress
  updateSkill(slugOrName, { actionState: 'analyzing', analysisStatus: 'pending' });
  startAnalysisTimeout(slugOrName);

  try {
    // Search results (not on daemon) → call Vercel analyzer directly with slug+source+path
    if (skill?.origin === 'search' && skill.registrySource) {
      const result = await analyzeSkillVercel(slug, skill.registrySource, {
        path: skill.registryPath,
      });
      clearAnalysisTimeout(slugOrName);
      updateSkill(slugOrName, {
        actionState: 'analyzed',
        analysisStatus: 'complete',
        analysis: result,
        envVariables: result.envVariables,
      });
      notify.success(`Analysis complete for "${skill.name}"`);
    } else {
      // Installed/downloaded/blocked skills → daemon has the files
      await analyzeSkillDaemon(slug);
      // SSE event (skills:analyzed / skills:analysis_failed) will update the store
    }
  } catch (err) {
    clearAnalysisTimeout(slugOrName);
    updateSkill(slugOrName, { actionState: 'analysis_failed' });
    notify.error(err instanceof Error ? err.message : `Analysis failed for "${slug}"`);
  }
}

export async function installSkill(slug: string): Promise<void> {
  updateSkill(slug, { actionState: 'installing' });
  try {
    await installSkillDaemon(slug);
    // SSE events (skills:installed / skills:install_failed) will update the store and notify
  } catch (err) {
    // HTTP-level errors (400 validation, 409 conflict, network errors)
    const skill = findSkill(slug);
    if (skill?.actionState === 'installing') {
      updateSkill(slug, { actionState: 'analyzed' });
    }
    notify.error(err instanceof Error ? err.message : `Failed to install "${slug}"`);
    throw err;
  }
}

export async function uninstallSkill(name: string): Promise<void> {
  try {
    await uninstallSkillDaemon(name);
    notify.success(`Skill "${name}" uninstalled`);
    await fetchInstalledSkills();
    queryClient.invalidateQueries({ queryKey: queryKeys.skillEnvRequirements });

    // Clean up skill-driven command policies
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      const configResp = await api.getConfig();
      const allPolicies = configResp.data?.policies ?? [];
      const filtered = allPolicies.filter((p) => p.preset !== `skill:${slug}`);
      if (filtered.length < allPolicies.length) {
        await api.updateConfig({ policies: filtered });
        queryClient.invalidateQueries({ queryKey: queryKeys.config });
      }
    } catch { /* best-effort cleanup */ }
  } catch (err) {
    notify.error(err instanceof Error ? err.message : `Failed to uninstall "${name}"`);
    throw err;
  }
}

export async function unblockSkill(name: string): Promise<void> {
  try {
    await unblockSkillDaemon(name);
    updateSkill(name, { actionState: 'installed', origin: 'installed' });
    notify.success(`Skill "${name}" unblocked`);
    await fetchInstalledSkills();
  } catch (err) {
    notify.error(err instanceof Error ? err.message : `Failed to unblock "${name}"`);
    throw err;
  }
}

export async function uploadSkillFiles(
  name: string,
  files: Array<{ name: string; type: string; content: string }>,
  meta?: { version?: string; author?: string; description?: string; tags?: string[] },
): Promise<void> {
  skillsStore.uploading = true;
  skillsStore.uploadError = null;

  try {
    await uploadSkillZipDaemon(name, files, meta);
    notify.success(`Skill "${name}" uploaded`);
    await fetchInstalledSkills();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    skillsStore.uploadError = msg;
    notify.error(msg);
  } finally {
    skillsStore.uploading = false;
  }
}

/** Convenience wrapper for drag-and-drop ZIP files (TODO: extract ZIP client-side) */
export async function uploadSkillZip(file: File): Promise<void> {
  skillsStore.uploading = true;
  skillsStore.uploadError = null;

  try {
    const content = await file.text();
    const name = file.name.replace(/\.zip$/i, '');
    await uploadSkillZipDaemon(name, [{ name: 'SKILL.md', type: 'text/markdown', content }]);
    notify.success(`Skill "${name}" uploaded`);
    await fetchInstalledSkills();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    skillsStore.uploadError = msg;
    notify.error(msg);
  } finally {
    skillsStore.uploading = false;
  }
}

/**
 * Fetch full detail for a skill. Tries daemon first, then marketplace.
 * Updates the entry in-place in the skills list (single source of truth).
 * Daemon GET /skills/:name now returns the same SkillSummary shape + content.
 */
export async function fetchSkillDetail(slugOrName: string): Promise<void> {
  skillsStore.selectedLoading = true;
  skillsStore.selectedId = slugOrName;

  try {
    // Daemon returns same shape as list items + content
    const detail = await fetchDaemonSkillDetail(slugOrName);
    const skill = mapDaemonSkill(detail);
    skill.readme = detail.content || undefined;
    skill.detailLoaded = true;
    upsertSkill(slugOrName, skill);
  } catch {
    // Daemon didn't have it — try marketplace
    try {
      const detail = await fetchMarketplaceSkillDetail(slugOrName);
      const existing = findSkill(slugOrName);

      const skill: UnifiedSkill = {
        name: detail.name,
        slug: detail.slug,
        description: detail.description,
        author: detail.author,
        version: detail.version,
        origin: existing?.origin ?? 'search',
        actionState: existing?.actionState ?? (detail.analysisStatus === 'complete' ? 'analyzed' : 'not_analyzed'),
        analysis: detail.analysis as AnalysisResult | undefined,
        analysisStatus: (detail.analysisStatus as 'pending' | 'complete' | 'error') ?? null,
        tags: detail.tags,
        readme: detail.readme || undefined,
        detailLoaded: true,
      };

      upsertSkill(slugOrName, skill);
    } catch {
      // Marketplace didn't have it — try Vercel search as last resort
      try {
        const result = await fetchSkillBySlugVercel(slugOrName);
        if (result) {
          const skill = mapSearchResult(result);
          skill.detailLoaded = true;
          upsertSkill(slugOrName, skill);

          // Persist in searchSkillsCache so fetchInstalledSkills re-merge preserves it
          if (!searchSkillsCache.some((s) => s.slug === skill.slug)) {
            searchSkillsCache.push(skill);
          }
        }
      } catch {
        // Not found anywhere — leave list as-is
      }
    }
  } finally {
    skillsStore.selectedLoading = false;
  }
}

export function clearSearch(): void {
  skillsStore.searchQuery = '';
  skillsStore.searchError = null;
  searchSkillsCache = [];
  skillsStore.skills = mergeSkills(installedSkillsCache, []);
}

/** Filter out internal agentshield-* tags for display purposes */
const INTERNAL_TAG_PREFIX = 'agentshield-';
export function filterDisplayTags(tags: string[] | readonly string[] | null | undefined): string[] {
  if (!tags) return [];
  return (tags as string[]).filter(t => !t.startsWith(INTERNAL_TAG_PREFIX));
}

/** Filter skills to only trusted (installed/downloaded/local/search/blocked) */
export function getTrustedSkills(skills: readonly { origin: string }[]): UnifiedSkill[] {
  return skills.filter((s) => s.origin !== 'untrusted') as unknown as UnifiedSkill[];
}

/** Filter skills to only untrusted */
export function getUntrustedSkills(skills: readonly { origin: string }[]): UnifiedSkill[] {
  return skills.filter((s) => s.origin === 'untrusted') as unknown as UnifiedSkill[];
}

/** Reinstall an untrusted skill (calls unblock → daemon installs from marketplace cache) */
export async function reinstallUntrustedSkill(name: string): Promise<void> {
  updateSkill(name, { actionState: 'installing' });
  try {
    await unblockSkillDaemon(name);
    notify.success(`Reinstalling "${name}"...`);
    await fetchInstalledSkills();
  } catch (err) {
    updateSkill(name, { actionState: 'analyzed' });
    notify.error(err instanceof Error ? err.message : `Failed to reinstall "${name}"`);
    throw err;
  }
}

/** Delete an untrusted skill permanently from marketplace cache */
export async function deleteUntrustedSkill(name: string): Promise<void> {
  try {
    await deleteSkillDaemon(name);
    // Clear selection if viewing the deleted skill
    const sel = skillsStore.selectedId;
    if (sel) {
      const skill = findSkill(sel);
      if (skill && (skill.name === name || skill.slug === name)) {
        skillsStore.selectedId = null;
      }
    }
    await fetchInstalledSkills(); // Daemon no longer returns deleted skill
    notify.success(`Skill "${name}" deleted`);
  } catch (err) {
    notify.error(err instanceof Error ? err.message : `Failed to delete "${name}"`);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  SSE event handler                                                  */
/* ------------------------------------------------------------------ */

/**
 * Handle skill-related SSE events pushed from the daemon.
 * Called from useSSE hook for any event type starting with 'skills:'.
 */
export function handleSkillSSEEvent(type: string, rawEvent: Record<string, unknown>): void {
  const payload = (rawEvent.data ?? rawEvent) as Record<string, unknown>;
  const name = payload.name as string | undefined;
  if (!name) return;

  switch (type) {
    case 'skills:analyzed': {
      clearAnalysisTimeout(name);
      updateSkill(name, { actionState: 'analyzed', analysisStatus: 'complete' });
      stopAnalysisPolling();
      notify.success(`Analysis complete for "${name}"`);
      // Refresh detail to pick up full analysis data
      fetchSkillDetail(name).catch(() => {/* best-effort */});
      break;
    }
    case 'skills:analysis_failed': {
      clearAnalysisTimeout(name);
      const error = (payload.error as string) || 'Analysis failed';
      updateSkill(name, { actionState: 'analysis_failed', analysisStatus: 'error' });
      stopAnalysisPolling();
      notify.error(`Analysis failed for "${name}": ${error}`);
      break;
    }
    case 'skills:install_started': {
      updateSkill(name, { actionState: 'installing' });
      break;
    }
    case 'skills:installed': {
      updateSkill(name, { actionState: 'installed', origin: 'installed' });
      const depsWarnings = payload.depsWarnings as string[] | undefined;
      if (depsWarnings?.length) {
        notify.warning(`Skill "${name}" installed with dependency warnings`);
      } else {
        notify.success(`Skill "${name}" installed`);
      }
      fetchInstalledSkills();
      fetchSkillDetail(name).catch(() => {/* best-effort */});
      break;
    }
    case 'skills:install_failed': {
      // Only show toast if skill is still in installing state (prevents duplicate from HTTP error handler)
      const skill = findSkill(name);
      if (skill?.actionState === 'installing') {
        const error = (payload.error as string) || 'Installation failed';
        updateSkill(name, { actionState: 'analyzed', analysisStatus: 'complete' });
        notify.error(`Failed to install "${name}": ${error}`);
        // Refresh detail to pick up analysis results (e.g. critical vulnerability data)
        fetchSkillDetail(name).catch(() => {/* best-effort */});
      }
      break;
    }
    case 'skills:uninstalled': {
      // Don't notify here — uninstallSkill() already shows a success toast.
      // SSE handler only refreshes the list.
      fetchInstalledSkills();
      break;
    }
    case 'skills:untrusted_detected': {
      const reason = (payload.reason as string) || 'Skill not in approved list';
      notify.warning(`Untrusted skill detected: "${name}" — ${reason}`);
      fetchInstalledSkills();
      break;
    }
    case 'skills:integrity_violation': {
      const action = (payload.action as string) || 'unknown';
      const modified = (payload.modifiedFiles as string[]) || [];
      const missing = (payload.missingFiles as string[]) || [];
      const fileList = [...modified, ...missing].slice(0, 3).join(', ');
      const suffix = fileList ? `: ${fileList}` : '';
      notify.warning(`Integrity violation on "${name}" (${action})${suffix}`);
      break;
    }
    case 'skills:integrity_restored': {
      notify.success(`Skill "${name}" restored to original content`);
      fetchInstalledSkills();
      break;
    }
    // skills:install_progress — no action needed, activity feed handles display
  }
}

/* ------------------------------------------------------------------ */
/*  Per-skill polling (legacy fallback)                                */
/* ------------------------------------------------------------------ */

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let pollingSlug: string | null = null;
let pollingStartedAt = 0;
const POLL_INTERVAL = 3000;
const MAX_POLL_DURATION = 5 * 60_000; // 5 minutes

function needsPolling(skill: UnifiedSkill | undefined): boolean {
  return skill?.actionState === 'analyzing' || skill?.actionState === 'installing';
}

/**
 * Poll a single skill via GET /skills/:name.
 * Stops automatically when the skill is no longer analyzing/installing,
 * or after MAX_POLL_DURATION to prevent infinite polling.
 */
export function startSkillPolling(slugOrName: string): void {
  // Already polling this exact skill
  if (pollingTimer && pollingSlug === slugOrName) return;
  // Stop any previous polling
  stopAnalysisPolling();

  pollingSlug = slugOrName;
  pollingStartedAt = Date.now();
  pollingTimer = setInterval(async () => {
    // Safety: stop polling after MAX_POLL_DURATION
    if (Date.now() - pollingStartedAt > MAX_POLL_DURATION) {
      console.warn(`[Skills] Polling timed out for ${slugOrName} after ${MAX_POLL_DURATION / 1000}s`);
      updateSkill(slugOrName, { actionState: 'analysis_failed' });
      stopAnalysisPolling();
      return;
    }

    try {
      const detail = await fetchDaemonSkillDetail(slugOrName);
      const skill = mapDaemonSkill(detail);

      // Preserve detail data (readme) from existing entry
      const existing = findSkill(slugOrName);
      if (existing?.detailLoaded) {
        skill.readme = existing.readme ?? (detail.content || undefined);
        skill.detailLoaded = true;
      }

      upsertSkill(slugOrName, skill);

      if (!needsPolling(skill)) {
        stopAnalysisPolling();
      }
    } catch {
      stopAnalysisPolling();
    }
  }, POLL_INTERVAL);
}

/** Convenience: find first skill needing polling and start per-skill poll. */
export function startAnalysisPolling(): void {
  const skill = skillsStore.skills.find(s => needsPolling(s));
  if (skill) {
    startSkillPolling(skill.slug);
  }
}

export function stopAnalysisPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    pollingSlug = null;
  }
}
