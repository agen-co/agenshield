/**
 * Direct API client for skills.agentfront.dev (Vercel Edge Functions).
 * Used by the skills store for search and analysis operations that
 * bypass the daemon and go directly to the public API.
 */

import type { AnalyzeSkillResponse, EnvVariableDetail } from '@agenshield/ipc';

const VERCEL_BASE = 'https://skills.agentfront.dev/api';
const DAEMON_BASE = '/api';

const SESSION_TOKEN_KEY = 'agenshield_session_token';

function getAuthToken(): string | null {
  return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

function authHeaders(includeContentType = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeContentType) headers['Content-Type'] = 'application/json';
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/* ------------------------------------------------------------------ */
/*  Vercel API (public, CORS-enabled)                                  */
/* ------------------------------------------------------------------ */

export interface SearchSkillResult {
  name: string;
  slug: string;
  description: string;
  author: string;
  version: string;
  installs: number;
  tags: string[];
  analysisStatus: 'complete' | 'pending' | null;
  analysis: {
    vulnerability: {
      level: string;
      details: string[];
      suggestions?: string[];
    };
  } | null;
}

export async function searchSkillsVercel(query: string): Promise<SearchSkillResult[]> {
  const res = await fetch(`${VERCEL_BASE}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Search failed: ${res.status}`);
  }
  return res.json();
}

export interface AnalysisResult {
  status: 'complete' | 'error';
  vulnerability: {
    level: string;
    details: string[];
    suggestions?: string[];
  };
  commands: Array<{
    name: string;
    source: string;
    available: boolean;
    required: boolean;
  }>;
  envVariables?: EnvVariableDetail[];
  securityFindings?: Array<{
    severity: string;
    category: string;
    cwe?: string;
    description: string;
  }>;
  mcpSpecificRisks?: Array<{
    riskType: string;
    description: string;
    severity: string;
  }>;
}

export async function getAnalysisVercel(
  skillName: string,
  publisher: string,
  version?: string,
): Promise<AnalysisResult | null> {
  const params = new URLSearchParams({ skillName, publisher });
  if (version) params.set('version', version);
  const res = await fetch(`${VERCEL_BASE}/analysis?${params}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Analysis lookup failed: ${res.status}`);
  return res.json();
}

/** NDJSON stream event from POST /api/analyze */
export interface AnalyzeStreamEvent {
  type: 'source' | 'file_result' | 'error' | 'done';
  data: Record<string, unknown>;
}

export async function analyzeSkillVercel(
  slug: string,
  source: 'clawhub' = 'clawhub',
  options?: { noCache?: boolean },
): Promise<AnalysisResult> {
  const res = await fetch(`${VERCEL_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, source, ...(options?.noCache ? { noCache: true } : {}) }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Analysis failed: ${res.status}`);
  }

  // Read NDJSON stream and extract the 'done' event
  const text = await res.text();
  const lines = text.trim().split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]) as AnalyzeStreamEvent;
      if (event.type === 'done') {
        return event.data as unknown as AnalysisResult;
      }
    } catch {
      // Skip malformed lines
    }
  }

  throw new Error('Analysis stream did not contain a done event');
}

export async function analyzeSkillFilesVercel(
  files: Array<{ name: string; type: string; content: string }>,
  skillName?: string,
  publisher?: string,
  options?: { noCache?: boolean },
): Promise<AnalysisResult> {
  const res = await fetch(`${VERCEL_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, skillName, publisher, ...(options?.noCache ? { noCache: true } : {}) }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Analysis failed: ${res.status}`);
  }

  const text = await res.text();
  const lines = text.trim().split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]) as AnalyzeStreamEvent;
      if (event.type === 'done') {
        return event.data as unknown as AnalysisResult;
      }
    } catch {
      // Skip malformed lines
    }
  }

  throw new Error('Analysis stream did not contain a done event');
}

/* ------------------------------------------------------------------ */
/*  Daemon API (local, auth-gated)                                     */
/* ------------------------------------------------------------------ */

export interface DaemonSkillSummary {
  name: string;
  source: 'user' | 'workspace' | 'quarantine' | 'marketplace' | 'untrusted';
  status: 'active' | 'workspace' | 'quarantined' | 'disabled' | 'downloaded' | 'blocked' | 'untrusted';
  description?: string;
  path: string;
  publisher?: string;
  version?: string;
  author?: string;
  sha?: string;
  tags?: string[];
  installationId?: string;
  analysis?: {
    status?: 'pending' | 'analyzing' | 'complete' | 'error' | 'installing';
    vulnerabilityLevel?: string;
    error?: string;
    vulnerability?: {
      level: string;
      details: string[];
      suggestions?: string[];
    };
    commands?: Array<{ name: string; source?: string; available: boolean; required?: boolean }>;
    envVariables?: Array<{ name: string; required: boolean; sensitive: boolean; purpose?: string }>;
    securityFindings?: Array<{ severity: string; category: string; cwe?: string; owaspCategory?: string; description: string; evidence?: string }>;
    mcpSpecificRisks?: Array<{ riskType: string; description: string; severity: string }>;
    runtimeRequirements?: Array<{ runtime: string; minVersion?: string; reason: string }>;
    installationSteps?: Array<{ command: string; packageManager: string; required: boolean; description: string }>;
    runCommands?: Array<{ command: string; description: string; entrypoint: boolean }>;
  };
}

export interface DaemonSkillDetail extends DaemonSkillSummary {
  content: string;
}

async function daemonRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const hasBody = !!options?.body;
  const res = await fetch(`${DAEMON_BASE}${endpoint}`, {
    ...options,
    headers: authHeaders(hasBody),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof (data as { error?: string }).error === 'string'
      ? (data as { error: string }).error
      : `API Error: ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function fetchDaemonSkills(): Promise<DaemonSkillSummary[]> {
  const res = await daemonRequest<{ data: DaemonSkillSummary[] }>('/skills');
  return res.data;
}

export async function fetchDaemonSkillDetail(name: string): Promise<DaemonSkillDetail> {
  const res = await daemonRequest<{ data: DaemonSkillDetail }>(`/skills/${encodeURIComponent(name)}`);
  return res.data;
}

export async function installSkillDaemon(slug: string): Promise<{ status: string; name: string }> {
  const res = await daemonRequest<{ data: { status: string; name: string } }>(
    '/marketplace/install',
    { method: 'POST', body: JSON.stringify({ slug }) },
  );
  return res.data;
}

export async function uninstallSkillDaemon(name: string): Promise<void> {
  await daemonRequest(`/skills/${encodeURIComponent(name)}/toggle`, { method: 'PUT', body: JSON.stringify({}) });
}

export async function unblockSkillDaemon(name: string): Promise<void> {
  await daemonRequest(`/skills/${encodeURIComponent(name)}/unblock`, { method: 'POST', body: JSON.stringify({}) });
}

export async function deleteSkillDaemon(name: string): Promise<void> {
  await daemonRequest(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

/** Ask daemon to analyze/re-analyze a skill. Daemon reads content from disk. Returns immediately with pending status. */
export async function analyzeSkillDaemon(name: string): Promise<{ status: string }> {
  const res = await daemonRequest<{ data: { status: string } }>(
    `/skills/${encodeURIComponent(name)}/analyze`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return res.data;
}

export async function uploadSkillZipDaemon(
  name: string,
  files: Array<{ name: string; type: string; content: string }>,
  meta?: { version?: string; author?: string; description?: string; tags?: string[] },
): Promise<{ name: string; slug: string }> {
  const res = await fetch(`${DAEMON_BASE}/skills/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, files, ...meta }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Upload failed: ${res.status}`);
  }
  return (data as { data: { name: string; slug: string } }).data;
}

export async function fetchMarketplaceSkillDetail(slug: string): Promise<{
  name: string;
  slug: string;
  description: string;
  author: string;
  version: string;
  readme?: string;
  tags: string[];
  analysis?: AnalyzeSkillResponse['analysis'];
  analysisStatus?: string;
}> {
  const res = await daemonRequest<{ data: {
    name: string;
    slug: string;
    description: string;
    author: string;
    version: string;
    readme?: string;
    tags: string[];
    analysis?: AnalyzeSkillResponse['analysis'];
    analysisStatus?: string;
  } }>(`/marketplace/skills/${encodeURIComponent(slug)}`);
  return res.data;
}
