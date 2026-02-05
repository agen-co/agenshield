/**
 * Marketplace Service
 *
 * Proxies requests to ClawHub via Convex HTTP API (search/detail) and agen.co (analysis).
 * Includes in-memory TTL cache for search and detail results.
 */

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
  '.ts': 'text/typescript',
  '.js': 'text/javascript',
  '.py': 'text/x-python',
  '.sh': 'text/x-shellscript',
  '.txt': 'text/plain',
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

  // Fetch all version files for analysis, fall back to readme-only
  let readme: string | undefined;
  const files: MarketplaceSkillFile[] = [];

  try {
    const allFiles = await convexAction<Array<{ path: string; text: string }>>(
      'skills:getVersionFiles',
      { versionId: latestVersion._id },
      SHORT_TIMEOUT,
    );
    for (const file of allFiles) {
      const isReadme = /readme/i.test(file.path);
      if (isReadme) readme = file.text;
      files.push({
        name: file.path,
        type: isReadme ? 'text/markdown' : guessContentType(file.path),
        content: file.text,
      });
    }
  } catch {
    // getVersionFiles not available — fall back to readme only
    try {
      const readmeData = await convexAction<{ path: string; text: string }>(
        'skills:getReadme',
        { versionId: latestVersion._id },
        SHORT_TIMEOUT,
      );
      readme = readmeData.text;
      files.push({
        name: readmeData.path,
        type: 'text/markdown',
        content: readmeData.text,
      });
    } catch {
      // Readme fetch also failed — degrade gracefully
    }
  }

  const tags = tagsFromRecord(skill.tags);

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

/**
 * Send skill files to the skills-analyzer edge function for AI-powered vulnerability analysis.
 * Consumes an NDJSON stream and returns the aggregated summary as AnalyzeSkillResponse.
 */
export async function analyzeSkillBundle(
  files: MarketplaceSkillFile[],
  skillName?: string,
  publisher?: string,
): Promise<AnalyzeSkillResponse> {
  const res = await fetch(SKILL_ANALYZER_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files, skillName, publisher }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upstream returned ${res.status}: ${text}`);
  }

  // Parse NDJSON stream to extract the 'done' event with aggregated summary
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('No response body from upstream');
  }

  const decoder = new TextDecoder();
  let buffer = '';
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

  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(SHORT_TIMEOUT),
  });

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
