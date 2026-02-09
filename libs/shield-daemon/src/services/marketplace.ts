/**
 * Marketplace Service
 *
 * Proxies requests to ClawHub via Convex HTTP API (search/detail) and agen.co (analysis).
 * Includes in-memory TTL cache for search and detail results.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CONFIG_DIR, MARKETPLACE_DIR } from '@agenshield/ipc';
import type {
  MarketplaceSkill,
  MarketplaceSkillFile,
  AnalyzeSkillResponse,
  EnvVariableDetail,
  RuntimeRequirement,
  InstallationStep,
  RunCommand,
  SecurityFinding,
  MCPSpecificRisk,
} from '@agenshield/ipc';

/* ------------------------------------------------------------------ */
/*  TTL Cache                                                          */
/* ------------------------------------------------------------------ */

const cache = new Map<string, { data: unknown; expiry: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown, ttlMs: number): void {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CONVEX_BASE = 'https://wry-manatee-359.convex.cloud';
const SKILL_ANALYZER_URL = process.env.SKILL_ANALYZER_URL || 'https://skills.agentfront.dev/api/analyze';
const SKILL_ANALYSIS_URL = SKILL_ANALYZER_URL.replace('/analyze', '/analysis');

const CLAWHUB_DOWNLOAD_BASE = process.env.CLAWHUB_DOWNLOAD_BASE || 'https://auth.clawdhub.com/api/v1';
const ZIP_TIMEOUT = 30_000;            // 30 seconds for zip download
const ANALYSIS_TIMEOUT = 4 * 60_000;   // 4 minutes for AI analysis

const SEARCH_CACHE_TTL = 60_000;       // 60 seconds
const DETAIL_CACHE_TTL = 5 * 60_000;   // 5 minutes

const SHORT_TIMEOUT = 10_000;  // 10 seconds

/* ------------------------------------------------------------------ */
/*  Convex wire types (internal)                                       */
/* ------------------------------------------------------------------ */

/** Each element returned by search:searchSkills action */
interface ConvexSearchResult {
  ownerHandle: string;
  score: number;
  skill: {
    displayName: string;
    slug: string;
    summary?: string;
    stats?: { downloads?: number };
    tags?: Record<string, string>;
  };
  version: {
    version: string;
    parsed?: {
      frontmatter?: {
        description?: string;
        tags?: string[];
      };
    };
  };
}

/** Shape returned by skills:getBySlug query */
interface ConvexSkillBySlug {
  skill: {
    displayName: string;
    slug: string;
    summary?: string;
    stats?: { downloads?: number };
    tags?: Record<string, string>;
  };
  owner: { handle: string; displayName?: string };
  latestVersion: {
    _id: string;
    version: string;
    files?: ConvexFileEntry[];
    parsed?: {
      frontmatter?: {
        description?: string;
        tags?: string[];
        name?: string;
      };
    };
  };
}

interface ConvexFileEntry {
  path: string;
  contentType: string;
  size: number;
  storageId: string;
}

/* ------------------------------------------------------------------ */
/*  Convex HTTP helpers                                                */
/* ------------------------------------------------------------------ */

interface ConvexResponse<T> {
  status: 'success' | 'error';
  value?: T;
  errorMessage?: string;
}

async function convexAction<T>(path: string, args: Record<string, unknown>, timeout: number): Promise<T> {
  const res = await fetch(`${CONVEX_BASE}/api/action`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });

  if (!res.ok) {
    throw new Error(`Convex action ${path} returned ${res.status}`);
  }

  const body = (await res.json()) as ConvexResponse<T>;
  if (body.status === 'error') {
    throw new Error(`Convex action ${path}: ${body.errorMessage ?? 'unknown error'}`);
  }
  return body.value as T;
}

async function convexQuery<T>(path: string, args: Record<string, unknown>, timeout: number): Promise<T> {
  const res = await fetch(`${CONVEX_BASE}/api/query`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });

  if (!res.ok) {
    throw new Error(`Convex query ${path} returned ${res.status}`);
  }

  const body = (await res.json()) as ConvexResponse<T>;
  if (body.status === 'error') {
    throw new Error(`Convex query ${path}: ${body.errorMessage ?? 'unknown error'}`);
  }
  return body.value as T;
}

/* ------------------------------------------------------------------ */
/*  Mapping helpers                                                    */
/* ------------------------------------------------------------------ */

const CONTENT_TYPE_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.py': 'text/x-python',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.txt': 'text/plain',
  '.env': 'text/plain',
  '.ini': 'text/plain',
};

function guessContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPE_MAP[ext] ?? 'text/plain';
}

function tagsFromRecord(tags?: Record<string, string>): string[] {
  if (!tags) return [];
  return Object.keys(tags).filter(k => k !== 'latest');
}

function mapSearchResult(result: ConvexSearchResult): MarketplaceSkill {
  const tags = tagsFromRecord(result.skill.tags);
  return {
    name: result.skill.displayName,
    slug: result.skill.slug,
    description: result.skill.summary || result.version.parsed?.frontmatter?.description || '',
    author: result.ownerHandle,
    version: result.version.version,
    installs: result.skill.stats?.downloads ?? 0,
    tags: tags.length > 0 ? tags : (result.version.parsed?.frontmatter?.tags ?? []),
  };
}

/* ------------------------------------------------------------------ */
/*  Zip Download & Local Storage                                       */
/* ------------------------------------------------------------------ */

function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'text/yaml' || mime === 'text/toml';
}

const IMAGE_EXT_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function isImageExt(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXT_MAP[ext] ?? null;
}

/** Max size for inline images (500KB before base64) */
const MAX_IMAGE_SIZE = 500_000;

function getMarketplaceDir(): string {
  return path.join(os.homedir(), CONFIG_DIR, MARKETPLACE_DIR);
}

/**
 * Download and extract a skill zip bundle from ClawHub.
 * Returns the extracted text files as MarketplaceSkillFile[].
 */
export async function downloadAndExtractZip(slug: string): Promise<MarketplaceSkillFile[]> {
  const url = `${CLAWHUB_DOWNLOAD_BASE}/download?slug=${encodeURIComponent(slug)}`;

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(ZIP_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`Zip download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  const files: MarketplaceSkillFile[] = [];

  for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const filename = zipPath.split('/').pop() || '';
    if (filename.startsWith('.')) continue;

    const mimeType = guessContentType(zipPath);

    // Text files
    if (isTextMime(mimeType)) {
      const content = await zipEntry.async('text');
      files.push({ name: zipPath, type: mimeType, content });
      continue;
    }

    // Image files — store as base64 data URIs
    const imageMime = isImageExt(zipPath);
    if (imageMime) {
      const buf = await zipEntry.async('nodebuffer');
      if (buf.length <= MAX_IMAGE_SIZE) {
        const dataUri = `data:${imageMime};base64,${buf.toString('base64')}`;
        files.push({ name: zipPath, type: imageMime, content: dataUri });
      }
    }
  }

  return files;
}

/** Metadata stored alongside downloaded skill files */
export interface DownloadedSkillMeta {
  name: string;
  slug: string;
  author: string;
  version: string;
  description: string;
  tags: string[];
  downloadedAt: string;
  /** Where this entry came from: 'marketplace' (preview/install) or 'watcher' (untrusted detection) */
  source?: 'marketplace' | 'watcher';
  analysis?: AnalyzeSkillResponse['analysis'];
  /** True once the skill has been installed (survives disable for re-enable) */
  wasInstalled?: boolean;
}

/**
 * Persist a downloaded skill to ~/.agenshield/marketplace/<slug>/.
 */
export function storeDownloadedSkill(
  slug: string,
  meta: Omit<DownloadedSkillMeta, 'downloadedAt'>,
  files: MarketplaceSkillFile[],
): void {
  const dir = path.join(getMarketplaceDir(), slug);
  const filesDir = path.join(dir, 'files');

  fs.mkdirSync(filesDir, { recursive: true });

  // Preserve existing source and analysis if not explicitly provided
  let source = meta.source;
  let analysis = meta.analysis;
  if (!source || !analysis) {
    try {
      const existingMetaPath = path.join(dir, 'metadata.json');
      if (fs.existsSync(existingMetaPath)) {
        const existing = JSON.parse(fs.readFileSync(existingMetaPath, 'utf-8')) as DownloadedSkillMeta;
        if (!source) source = existing.source;
        if (!analysis) analysis = existing.analysis;
      }
    } catch { /* best-effort */ }
  }

  // Write metadata
  const fullMeta: DownloadedSkillMeta = { ...meta, source, analysis, downloadedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(fullMeta, null, 2), 'utf-8');

  // Write each file
  for (const file of files) {
    const filePath = path.join(filesDir, file.name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content, 'utf-8');
  }

  console.log(`[Marketplace] Stored ${files.length} files for ${slug}`);
}

/**
 * Update the analysis result in an already-stored download.
 */
export function updateDownloadedAnalysis(slug: string, analysis: AnalyzeSkillResponse['analysis']): void {
  const metaPath = path.join(getMarketplaceDir(), slug, 'metadata.json');
  try {
    if (!fs.existsSync(metaPath)) return;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as DownloadedSkillMeta;
    meta.analysis = analysis;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  } catch {
    // Best-effort
  }
}

/**
 * Mark a downloaded skill as having been installed.
 * Survives disable so the skill can be shown as "disabled" in GET /skills.
 */
export function markDownloadedAsInstalled(slug: string): void {
  const metaPath = path.join(getMarketplaceDir(), slug, 'metadata.json');
  try {
    if (!fs.existsSync(metaPath)) return;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as DownloadedSkillMeta;
    if (meta.wasInstalled) return; // already marked
    meta.wasInstalled = true;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  } catch {
    // Best-effort
  }
}

/** Summary info for a downloaded skill */
export interface DownloadedSkillInfo {
  slug: string;
  name: string;
  author: string;
  version: string;
  description: string;
  tags: string[];
  hasAnalysis: boolean;
  /** Where this entry came from: 'marketplace' (preview/install) or 'watcher' (untrusted detection) */
  source?: 'marketplace' | 'watcher';
  analysis?: AnalyzeSkillResponse['analysis'];
  /** True once the skill has been installed (survives disable for re-enable) */
  wasInstalled?: boolean;
}

/**
 * List all downloaded marketplace skills from ~/.agenshield/marketplace/.
 */
export function listDownloadedSkills(): DownloadedSkillInfo[] {
  const baseDir = getMarketplaceDir();
  if (!fs.existsSync(baseDir)) return [];

  const results: DownloadedSkillInfo[] = [];
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(baseDir, entry.name, 'metadata.json');
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as DownloadedSkillMeta;
        results.push({
          slug: meta.slug,
          name: meta.name,
          author: meta.author,
          version: meta.version,
          description: meta.description,
          tags: meta.tags ?? [],
          hasAnalysis: !!meta.analysis,
          source: meta.source,
          analysis: meta.analysis,
          wasInstalled: meta.wasInstalled ?? false,
        });
      } catch {
        // Skip malformed entries
      }
    }
  } catch {
    // Directory not readable
  }
  return results;
}

/**
 * Read all files for a downloaded skill from the local cache.
 */
export function getDownloadedSkillFiles(slug: string): MarketplaceSkillFile[] {
  const filesDir = path.join(getMarketplaceDir(), slug, 'files');
  if (!fs.existsSync(filesDir)) return [];

  const files: MarketplaceSkillFile[] = [];

  function walk(dir: string, prefix: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
        files.push({ name: rel, type: guessContentType(entry.name), content });
      }
    }
  }

  walk(filesDir, '');
  return files;
}

/**
 * Get the metadata for a downloaded skill, or null if not downloaded.
 */
export function getDownloadedSkillMeta(slug: string): DownloadedSkillMeta | null {
  const metaPath = path.join(getMarketplaceDir(), slug, 'metadata.json');
  try {
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as DownloadedSkillMeta;
    }
  } catch {
    // Not found or malformed
  }
  return null;
}

/**
 * Delete a downloaded skill's marketplace cache folder.
 */
export function deleteDownloadedSkill(slug: string): void {
  const dir = path.join(getMarketplaceDir(), slug);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Inline relative image references in markdown with data URIs from extracted files.
 * Replaces ![alt](path/to/image.png) with ![alt](data:image/png;base64,...)
 */
export function inlineImagesInMarkdown(
  markdown: string,
  files: MarketplaceSkillFile[],
): string {
  // Build a lookup of image files by their filename (stripped of leading dirs)
  const imageMap = new Map<string, string>();
  for (const file of files) {
    const mime = isImageExt(file.name);
    if (mime && file.content.startsWith('data:')) {
      // Map both the full path and the basename
      imageMap.set(file.name, file.content);
      const basename = file.name.split('/').pop() ?? '';
      if (basename && !imageMap.has(basename)) {
        imageMap.set(basename, file.content);
      }
    }
  }

  if (imageMap.size === 0) return markdown;

  // Replace markdown image references: ![alt](path)
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, alt: string, src: string) => {
      // Skip absolute URLs
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
        return _match;
      }
      // Try exact path, then basename, then normalized
      const normalized = src.replace(/^\.\//, '');
      const dataUri = imageMap.get(src)
        ?? imageMap.get(normalized)
        ?? imageMap.get(normalized.split('/').pop() ?? '');
      if (dataUri) {
        return `![${alt}](${dataUri})`;
      }
      return _match;
    }
  );
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

/**
 * Search the ClawHub marketplace for skills via Convex.
 * Results are cached for 60 seconds keyed by query string.
 */
export async function searchMarketplace(query: string): Promise<MarketplaceSkill[]> {
  const cacheKey = `search:${query}`;
  const cached = getCached<MarketplaceSkill[]>(cacheKey);
  if (cached) return cached;

  const results = await convexAction<ConvexSearchResult[]>(
    'search:searchSkills',
    { highlightedOnly: false, limit: 25, query },
    SHORT_TIMEOUT,
  );

  const skills = results.map(mapSearchResult);
  setCache(cacheKey, skills, SEARCH_CACHE_TTL);
  return skills;
}

/* ------------------------------------------------------------------ */
/*  Skill Detail                                                       */
/* ------------------------------------------------------------------ */

/**
 * Get a single skill's detail from ClawHub by slug via Convex.
 * Fetches readme and file contents in parallel.
 * Cached for 5 minutes.
 */
export async function getMarketplaceSkill(slug: string): Promise<MarketplaceSkill> {
  const cacheKey = `detail:${slug}`;
  const cached = getCached<MarketplaceSkill>(cacheKey);
  if (cached) return cached;

  const detail = await convexQuery<ConvexSkillBySlug>(
    'skills:getBySlug',
    { slug },
    SHORT_TIMEOUT,
  );

  const { skill, owner, latestVersion } = detail;

  // Fetch all files with cascading fallback strategy
  let readme: string | undefined;
  const files: MarketplaceSkillFile[] = [];

  // PRIMARY: Download zip bundle from ClawHub
  try {
    console.log(`[Marketplace] Downloading zip for ${slug}...`);
    const zipFiles = await downloadAndExtractZip(slug);
    for (const file of zipFiles) {
      if (/readme|skill\.md/i.test(file.name) && !readme) readme = file.content;
      files.push(file);
    }
    console.log(`[Marketplace] Extracted ${files.length} files from zip`);
  } catch (zipErr) {
    console.warn(`[Marketplace] Zip download failed for ${slug}: ${(zipErr as Error).message}`);

    // FALLBACK 1: Try Convex getVersionFiles
    try {
      console.log(`[Marketplace] Falling back to getVersionFiles for ${slug}...`);
      const allFiles = await convexAction<Array<{ path: string; text: string }>>(
        'skills:getVersionFiles',
        { versionId: latestVersion._id },
        SHORT_TIMEOUT,
      );
      for (const file of allFiles) {
        const isReadme = /readme|skill\.md/i.test(file.path);
        if (isReadme && !readme) readme = file.text;
        files.push({
          name: file.path,
          type: isReadme ? 'text/markdown' : guessContentType(file.path),
          content: file.text,
        });
      }
      console.log(`[Marketplace] Got ${files.length} files from Convex action`);
    } catch (convexErr) {
      console.warn(`[Marketplace] getVersionFiles failed for ${slug}: ${(convexErr as Error).message}`);

      // FALLBACK 2: Try readme only
      try {
        console.log(`[Marketplace] Falling back to getReadme for ${slug}...`);
        const readmeData = await convexAction<{ path: string; text: string }>(
          'skills:getReadme',
          { versionId: latestVersion._id },
          SHORT_TIMEOUT,
        );
        readme = readmeData.text;
        files.push({ name: readmeData.path, type: 'text/markdown', content: readmeData.text });
        console.log(`[Marketplace] Got readme only for ${slug}`);
      } catch {
        console.warn(`[Marketplace] All file fetch methods failed for ${slug}`);
      }
    }
  }

  // Persist to download cache for later install/re-enable
  if (files.length > 0) {
    try {
      storeDownloadedSkill(slug, {
        name: skill.displayName,
        slug: skill.slug,
        author: owner.handle,
        version: latestVersion.version,
        description: skill.summary || latestVersion.parsed?.frontmatter?.description || '',
        tags: tagsFromRecord(skill.tags).length > 0
          ? tagsFromRecord(skill.tags)
          : (latestVersion.parsed?.frontmatter?.tags ?? []),
      }, files);
    } catch (storeErr) {
      console.warn(`[Marketplace] Failed to store download for ${slug}: ${(storeErr as Error).message}`);
    }
  }

  const tags = tagsFromRecord(skill.tags);

  // Inline images in the readme so markdown renders them
  if (readme && files.length > 0) {
    readme = inlineImagesInMarkdown(readme, files);
  }

  const mapped: MarketplaceSkill = {
    name: skill.displayName,
    slug: skill.slug,
    description: skill.summary || latestVersion.parsed?.frontmatter?.description || '',
    author: owner.handle,
    version: latestVersion.version,
    installs: skill.stats?.downloads ?? 0,
    tags: tags.length > 0 ? tags : (latestVersion.parsed?.frontmatter?.tags ?? []),
    readme,
    files,
  };

  setCache(cacheKey, mapped, DETAIL_CACHE_TTL);
  return mapped;
}

/* ------------------------------------------------------------------ */
/*  Analyze                                                            */
/* ------------------------------------------------------------------ */

type AnalysisSummary = {
  status: 'complete' | 'error';
  vulnerability: { level: string; details: string[]; suggestions?: string[] };
  commands: Array<{ name: string; source: string; available: boolean; required: boolean }>;
  envVariables?: EnvVariableDetail[];
  runtimeRequirements?: RuntimeRequirement[];
  installationSteps?: InstallationStep[];
  runCommands?: RunCommand[];
  securityFindings?: SecurityFinding[];
  mcpSpecificRisks?: MCPSpecificRisk[];
};

/**
 * Parse an NDJSON response stream from the skills-analyzer, extracting the 'done' event.
 */
async function parseAnalysisStream(res: Response): Promise<AnalyzeSkillResponse> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('No response body from upstream');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let summary: AnalysisSummary | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { type: string; data: unknown };
        if (event.type === 'done') {
          summary = event.data as AnalysisSummary;
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer) as { type: string; data: unknown };
      if (event.type === 'done') {
        summary = event.data as AnalysisSummary;
      }
    } catch {
      // Skip malformed line
    }
  }

  if (!summary) {
    throw new Error('No summary received from upstream analysis');
  }

  return {
    analysis: {
      status: summary.status,
      vulnerability: {
        level: summary.vulnerability.level as AnalyzeSkillResponse['analysis']['vulnerability']['level'],
        details: summary.vulnerability.details,
        suggestions: summary.vulnerability.suggestions,
      },
      commands: summary.commands.map(c => ({
        name: c.name,
        source: c.source,
        available: c.available,
        required: c.required,
      })),
      envVariables: summary.envVariables,
      runtimeRequirements: summary.runtimeRequirements,
      installationSteps: summary.installationSteps,
      runCommands: summary.runCommands,
      securityFindings: summary.securityFindings,
      mcpSpecificRisks: summary.mcpSpecificRisks,
    },
  };
}

/**
 * Send skill files to the skills-analyzer edge function for AI-powered vulnerability analysis.
 * Consumes an NDJSON stream and returns the aggregated summary as AnalyzeSkillResponse.
 */
export async function analyzeSkillBundle(
  files: MarketplaceSkillFile[],
  skillName?: string,
  publisher?: string,
  options?: { noCache?: boolean },
): Promise<AnalyzeSkillResponse> {
  console.log(`[Marketplace] Vercel analyze request: POST ${SKILL_ANALYZER_URL} skillName=${skillName ?? '(none)'} files=${files.length} noCache=${options?.noCache ?? false}`);
  const res = await fetch(SKILL_ANALYZER_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(ANALYSIS_TIMEOUT),
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files, skillName, publisher, ...(options?.noCache ? { noCache: true } : {}) }),
  });

  console.log(`[Marketplace] Vercel analyze response: status=${res.status}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upstream returned ${res.status}: ${text}`);
  }

  const result = await parseAnalysisStream(res);
  console.log(`[Marketplace] Vercel analyze result: vulnerability=${result.analysis.vulnerability?.level} commands=${result.analysis.commands?.length ?? 0} securityFindings=${result.analysis.securityFindings?.length ?? 0} envVars=${result.analysis.envVariables?.length ?? 0}`);
  return result;
}

/**
 * Forward a slug + source to the skills-analyzer for remote ZIP download and analysis.
 * Vercel handles the ZIP download directly — no local files needed.
 */
export async function analyzeSkillBySlug(
  slug: string,
  skillName?: string,
  publisher?: string,
  options?: { noCache?: boolean },
): Promise<AnalyzeSkillResponse> {
  console.log(`[Marketplace] Vercel analyze request: POST ${SKILL_ANALYZER_URL} slug=${slug} noCache=${options?.noCache ?? false}`);
  const res = await fetch(SKILL_ANALYZER_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(ANALYSIS_TIMEOUT),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, source: 'clawhub', skillName, publisher, ...(options?.noCache ? { noCache: true } : {}) }),
  });

  console.log(`[Marketplace] Vercel analyze response: status=${res.status}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upstream returned ${res.status}: ${text}`);
  }

  const result = await parseAnalysisStream(res);
  console.log(`[Marketplace] Vercel analyze result: vulnerability=${result.analysis.vulnerability?.level} commands=${result.analysis.commands?.length ?? 0} securityFindings=${result.analysis.securityFindings?.length ?? 0} envVars=${result.analysis.envVariables?.length ?? 0}`);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Cached Analysis Lookup                                             */
/* ------------------------------------------------------------------ */

/**
 * Retrieve a previously cached analysis for a skill by name and publisher.
 * Returns null if no cached result exists (upstream returns 404).
 */
export async function getCachedAnalysis(
  skillName: string,
  publisher: string,
): Promise<AnalyzeSkillResponse | null> {
  const url = `${SKILL_ANALYSIS_URL}?skillName=${encodeURIComponent(skillName)}&publisher=${encodeURIComponent(publisher)}`;
  console.log(`[Marketplace] Vercel analysis lookup: GET ${url}`);

  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(SHORT_TIMEOUT),
  });

  console.log(`[Marketplace] Vercel analysis lookup: status=${res.status}`);
  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`Upstream returned ${res.status}`);
  }

  const summary = (await res.json()) as {
    status: 'complete' | 'error';
    vulnerability: { level: string; details: string[]; suggestions?: string[] };
    commands: Array<{ name: string; source: string; available: boolean; required: boolean }>;
    envVariables?: EnvVariableDetail[];
    runtimeRequirements?: RuntimeRequirement[];
    installationSteps?: InstallationStep[];
    runCommands?: RunCommand[];
    securityFindings?: SecurityFinding[];
    mcpSpecificRisks?: MCPSpecificRisk[];
  };

  return {
    analysis: {
      status: summary.status,
      vulnerability: {
        level: summary.vulnerability.level as AnalyzeSkillResponse['analysis']['vulnerability']['level'],
        details: summary.vulnerability.details,
        suggestions: summary.vulnerability.suggestions,
      },
      commands: summary.commands.map(c => ({
        name: c.name,
        source: c.source,
        available: c.available,
        required: c.required,
      })),
      envVariables: summary.envVariables,
      runtimeRequirements: summary.runtimeRequirements,
      installationSteps: summary.installationSteps,
      runCommands: summary.runCommands,
      securityFindings: summary.securityFindings,
      mcpSpecificRisks: summary.mcpSpecificRisks,
    },
  };
}
