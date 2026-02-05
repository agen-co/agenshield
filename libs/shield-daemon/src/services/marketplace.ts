/**
 * Marketplace Service
 *
 * Proxies requests to ClawHub via Convex HTTP API (search/detail) and agen.co (analysis).
 * Includes in-memory TTL cache for search and detail results.
 */

import type { MarketplaceSkill, MarketplaceSkillFile, AnalyzeSkillResponse } from '@agenshield/ipc';

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
const AGENCO_ANALYZE = 'https://agen.co/analyze/skill';

const SEARCH_CACHE_TTL = 60_000;       // 60 seconds
const DETAIL_CACHE_TTL = 5 * 60_000;   // 5 minutes

const SHORT_TIMEOUT = 10_000;  // 10 seconds
const LONG_TIMEOUT = 30_000;   // 30 seconds

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

  // Fetch readme content (the only file content accessible via public Convex API)
  let readme: string | undefined;
  const files: MarketplaceSkillFile[] = [];

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
    // Readme fetch failed — degrade gracefully
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
 * Send skill files to agen.co for vulnerability analysis.
 * Not cached — one-shot operation.
 */
export async function analyzeSkillBundle(
  files: MarketplaceSkillFile[]
): Promise<AnalyzeSkillResponse> {
  const res = await fetch(AGENCO_ANALYZE, {
    method: 'POST',
    signal: AbortSignal.timeout(LONG_TIMEOUT),
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ files }),
  });

  if (!res.ok) {
    throw new Error(`Upstream returned ${res.status}`);
  }

  return (await res.json()) as AnalyzeSkillResponse;
}
