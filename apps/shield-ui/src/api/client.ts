/**
 * API client for AgenShield daemon
 */

import type {
  HealthResponse,
  GetConfigResponse,
  UpdateConfigResponse,
  UpdateConfigRequest,
  ApiResponse,
  PolicyConfig,
  SkillAnalysis,
  SystemBinary,
  DiscoveryResult,
  AgenCoIntegrationsListResponse,
  AgenCoConnectedIntegrationsResponse,
  AgenCoConnectIntegrationResponse,
  FsBrowseEntry,
  SecurityStatusData,
  MarketplaceSkill,
  AnalyzeSkillRequestUnion,
  AnalyzeSkillResponse,
  InstallSkillRequest,
  Alert,
  SimulateRequest,
  SimulateResponse,
  LogBundle,
} from '@agenshield/ipc';

import type { WorkspaceSkillStatus } from '@agenshield/ipc';
import { scopeStore } from '../state/scope';

export interface WorkspaceSkillSummary {
  id: string;
  profileId: string;
  workspacePath: string;
  skillName: string;
  status: WorkspaceSkillStatus;
  contentHash?: string;
  backupHash?: string;
  approvedBy?: string;
  approvedAt?: string;
  cloudSkillId?: string;
  removedAt?: string;
  aclApplied: boolean;
  createdAt: string;
  updatedAt: string;
}

const BASE_URL = '/api';

const SESSION_TOKEN_KEY = 'agenshield_jwt_token';
const SESSION_EXPIRES_KEY = 'agenshield_jwt_expires';

/**
 * Get the current auth token from session storage
 */
function getAuthToken(): string | null {
  return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

/**
 * Build headers including auth token if available
 */
function buildHeaders(extra?: HeadersInit, hasBody?: boolean): HeadersInit {
  const headers: Record<string, string> = {};

  // Shield context headers
  headers['x-shield-source'] = 'ui';
  headers['x-shield-trace-id'] = crypto.randomUUID();

  // Scope headers for multi-tenancy
  if (scopeStore.profileId) {
    headers['x-shield-profile-id'] = scopeStore.profileId;
  }

  if (hasBody !== false) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (extra) {
    const extraHeaders = extra instanceof Headers
      ? Object.fromEntries(Array.from(extra as unknown as Iterable<[string, string]>))
      : Array.isArray(extra)
        ? Object.fromEntries(extra)
        : extra;
    Object.assign(headers, extraHeaders);
  }

  return headers;
}

/**
 * Authenticated fetch wrapper. Merges auth + shield-context headers into
 * any `fetch()` call so callers outside the `api.*` methods don't need to
 * build headers manually.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const hasBody = !!init?.body;
  return fetch(input, {
    ...init,
    headers: buildHeaders(init?.headers, hasBody),
  });
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: buildHeaders(options?.headers, !!options?.body),
    });
  } catch {
    throw new Error('Unable to connect to daemon');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // On 401, clear stale token and notify AuthContext to reset to read-only
    if (res.status === 401) {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_EXPIRES_KEY);
      window.dispatchEvent(new CustomEvent('agenshield:auth-expired'));
    }

    const msg = typeof data.error === 'string' ? data.error : data.error?.message;
    const error = new Error(msg || `API Error: ${res.status} ${res.statusText}`);
    (error as Error & { status: number }).status = res.status;
    throw error;
  }

  return data as T;
}

// --- Types for new endpoints ---

export interface SkillSummary {
  name: string;
  source: 'user' | 'workspace' | 'quarantine' | 'marketplace';
  status: 'active' | 'workspace' | 'quarantined' | 'disabled' | 'downloaded';
  description?: string;
  path: string;
  publisher?: string;
}

export interface SkillDetail extends SkillSummary {
  content: string;
  metadata?: Record<string, unknown>;
  analysis?: SkillAnalysis;
}

export type SecretScope = 'global' | 'policed' | 'standalone';

export interface Secret {
  id: string;
  name: string;
  policyIds: string[];
  maskedValue: string;
  createdAt: string;
  scope: SecretScope;
}

export interface CreateSecretRequest {
  name: string;
  value: string;
  policyIds: string[];
  scope?: SecretScope;
}

export interface SkillEnvRequirement {
  name: string;
  required: boolean;
  sensitive: boolean;
  purpose: string;
  requiredBy: Array<{ skillName: string }>;
  fulfilled: boolean;
  existingSecretScope?: SecretScope;
  existingSecretId?: string;
}

export type SecurityStatus = SecurityStatusData;

export interface McpServerSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  url: string | null;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  authType: 'none' | 'oauth' | 'apikey' | 'bearer';
  source: 'manual' | 'cloud' | 'agenco' | 'workspace';
  managed: boolean;
  managedSource: string | null;
  status: 'active' | 'disabled' | 'pending' | 'blocked';
  profileId: string | null;
  supportedTargets: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMcpServerRequest {
  name: string;
  slug: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  description?: string;
  url?: string | null;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  authType?: 'none' | 'oauth' | 'apikey' | 'bearer';
  source?: 'manual' | 'cloud' | 'agenco' | 'workspace';
  status?: 'active' | 'disabled' | 'pending' | 'blocked';
  profileId?: string | null;
  supportedTargets?: string[];
}

// --- API methods ---

export const api = {
  // System metrics
  getMetrics: () =>
    request<{ success: boolean; data: {
      cpuPercent: number; memPercent: number; diskPercent: number; netUp: number; netDown: number;
      hostname?: string; activeUser?: string; uptime?: number; platform?: string; arch?: string;
      cpuModel?: string; totalMemory?: number; nodeVersion?: string;
    } }>('/metrics'),

  // Activity history
  getActivity: (limit = 500, profileId?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (profileId) params.set('profileId', profileId);
    return request<{ data: Array<{ type: string; timestamp: string; data: unknown; profileId?: string; source?: string }> }>(
      `/activity?${params.toString()}`
    );
  },

  // Existing endpoints
  getHealth: () => request<HealthResponse>('/health'),

  getConfig: () => request<GetConfigResponse>('/config'),

  updateConfig: (data: UpdateConfigRequest) =>
    request<UpdateConfigResponse>('/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Individual policy CRUD
  createPolicy: (data: PolicyConfig) =>
    request<ApiResponse<PolicyConfig>>('/config/policies', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updatePolicy: (id: string, data: Record<string, unknown>) =>
    request<ApiResponse<PolicyConfig>>(`/config/policies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deletePolicy: (id: string) =>
    request<ApiResponse<{ deleted: boolean }>>(`/config/policies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  togglePolicy: (id: string, enabled: boolean) =>
    request<ApiResponse<PolicyConfig>>(`/config/policies/${encodeURIComponent(id)}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),

  // Skills endpoints
  getSkills: () => request<{ data: SkillSummary[] }>('/skills'),

  getSkill: (name: string) => request<{ data: SkillDetail }>(`/skills/${encodeURIComponent(name)}`),

  toggleSkill: (name: string) =>
    request<{ data: SkillDetail }>(`/skills/${encodeURIComponent(name)}/toggle`, { method: 'PUT' }),

  activateSkill: (name: string) =>
    request<{ data: SkillDetail }>(`/skills/${encodeURIComponent(name)}/activate`, { method: 'POST' }),

  quarantineSkill: (name: string) =>
    request<{ data: SkillDetail }>(`/skills/${encodeURIComponent(name)}/quarantine`, { method: 'POST' }),

  // Secrets endpoints
  getSecrets: () => request<{ data: Secret[] }>('/secrets'),

  getAvailableEnvSecrets: () => request<{ data: string[] }>('/secrets/env'),

  getSkillEnvRequirements: () => request<{ data: SkillEnvRequirement[] }>('/secrets/skill-env'),

  createSecret: (data: CreateSecretRequest) =>
    request<{ data: Secret }>('/secrets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteSecret: (id: string) =>
    request<{ deleted: boolean }>(`/secrets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  updateSecret: (id: string, data: { policyIds: string[] }) =>
    request<{ data: Secret }>(`/secrets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Security endpoint
  getSecurity: () => request<{ data: SecurityStatus }>('/security'),

  // Skill analysis
  reanalyzeSkill: (name: string, content?: string, metadata?: Record<string, unknown>) =>
    request<{ data: { analysis: SkillAnalysis } }>(`/skills/${encodeURIComponent(name)}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ content, metadata }),
    }),

  // Marketplace endpoints
  marketplace: {
    search: (query: string) =>
      request<{ data: MarketplaceSkill[] }>(`/marketplace/search?q=${encodeURIComponent(query)}`),
    getSkill: (slug: string) =>
      request<{ data: MarketplaceSkill }>(`/marketplace/skills/${encodeURIComponent(slug)}`),
    analyzeSkill: (data: AnalyzeSkillRequestUnion) =>
      request<{ data: AnalyzeSkillResponse }>('/marketplace/analyze', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    installSkill: (data: InstallSkillRequest) =>
      request<{ data: { success: boolean; name: string; analysis?: AnalyzeSkillResponse['analysis']; logs?: string[] } }>('/marketplace/install', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getCachedAnalysis: async (skillName: string, publisher: string) => {
      try {
        return await request<{ data: AnalyzeSkillResponse }>(
          `/marketplace/analysis?skillName=${encodeURIComponent(skillName)}&publisher=${encodeURIComponent(publisher)}`
        );
      } catch (err) {
        if ((err as Error & { status?: number }).status === 404) return null;
        throw err;
      }
    },
  },

  // System binaries & allowed commands
  getSystemBins: () =>
    request<{ data: { bins: SystemBinary[] } }>('/exec/system-bins'),

  getAllowedCommands: () =>
    request<{ data: { commands: Array<{ name: string; paths: string[]; addedAt: string; addedBy: string; category?: string }> } }>('/exec/allowed-commands'),

  // Discovery endpoint
  getDiscovery: (refresh = false) =>
    request<{ success: boolean; data: DiscoveryResult }>(`/discovery/scan?refresh=${refresh}`),

  // AgenCo endpoints
  agenco: {
    getAuthStatus: () =>
      request<{ success: boolean; data: { authenticated: boolean; expired: boolean; expiresAt: string | null; connectedIntegrations: string[] } }>('/agenco/auth/status'),

    startAuth: () =>
      request<{ success: boolean; data?: { authUrl?: string; message?: string }; error?: string }>('/agenco/auth/start', {
        method: 'POST',
        body: JSON.stringify({}),
      }),

    logout: () =>
      request<{ success: boolean }>('/agenco/auth/logout', { method: 'POST' }),

    getMCPStatus: () =>
      request<{ success: boolean; data: { state: string; active: boolean } }>('/agenco/mcp/status'),

    listIntegrations: (category?: string, search?: string) => {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (search) params.set('search', search);
      const qs = params.toString();
      return request<{ success: boolean; data: AgenCoIntegrationsListResponse }>(`/agenco/integrations${qs ? `?${qs}` : ''}`);
    },

    listConnectedIntegrations: () =>
      request<{ success: boolean; data: AgenCoConnectedIntegrationsResponse }>('/agenco/integrations/connected'),

    connectIntegration: (integration: string, scopes?: string[]) =>
      request<{ success: boolean; data: AgenCoConnectIntegrationResponse & { skillProvisioned?: boolean } }>('/agenco/integrations/connect', {
        method: 'POST',
        body: JSON.stringify({ integration, scopes }),
      }),

    disconnectIntegration: (integration: string) =>
      request<{ success: boolean; data: { connectedIntegrations: string[] } }>('/agenco/integrations/disconnect', {
        method: 'POST',
        body: JSON.stringify({ integration }),
      }),

    getSkillStatus: () =>
      request<{ success: boolean; data: { installed: boolean; skillName: string } }>('/agenco/skills/status'),

    syncSkills: () =>
      request<{ success: boolean; data: { installed: string[]; removed: string[]; updated: string[]; errors: string[] } }>('/agenco/skills/sync', {
        method: 'POST',
      }),
  },

  // OpenClaw gateway lifecycle
  openclaw: {
    getStatus: () =>
      request<{ success: boolean; data: { daemon: { running: boolean; pid?: number }; gateway: { running: boolean; pid?: number } } }>('/openclaw/status'),
    start: () =>
      request<{ success: boolean; data: { message: string } }>('/openclaw/start', { method: 'POST' }),
    stop: () =>
      request<{ success: boolean; data: { message: string } }>('/openclaw/stop', { method: 'POST' }),
    restart: () =>
      request<{ success: boolean; data: { message: string } }>('/openclaw/restart', { method: 'POST' }),
    getDashboardUrl: () =>
      request<{ success: boolean; data: { url: string; token: string } }>('/openclaw/dashboard-url'),
  },

  // Profile management
  getProfiles: () =>
    request<{ data: Array<{ id: string; name: string; type: string; targetName?: string; presetId?: string; description?: string; agentUsername?: string; agentUid?: number; agentHomeDir?: string; brokerUsername?: string; brokerUid?: number; brokerHomeDir?: string; policiesCount?: number; secretsCount?: number; workspacePaths?: string[]; createdAt: string; updatedAt: string }> }>('/profiles'),

  createProfile: (body: { id: string; name: string; type?: string; targetName?: string; presetId?: string; description?: string }) =>
    request<{ data: { id: string; name: string; type: string; createdAt: string; updatedAt: string } }>('/profiles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateProfile: (id: string, body: { name?: string; description?: string; presetId?: string }) =>
    request<{ data: { id: string; name: string; type: string; createdAt: string; updatedAt: string } }>(`/profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteProfile: (id: string) =>
    request<{ deleted: boolean }>(`/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Factory reset
  factoryReset: () =>
    request<{ success: boolean }>('/config/factory-reset', { method: 'POST' }),

  // Filesystem browse
  browsePath: (dirPath?: string, showHidden = false) => {
    const params = new URLSearchParams();
    if (dirPath) params.set('path', dirPath);
    if (showHidden) params.set('showHidden', 'true');
    const qs = params.toString();
    return request<{ success: boolean; data: { entries: FsBrowseEntry[] } }>(`/fs/browse${qs ? `?${qs}` : ''}`);
  },

  // Playground
  playground: {
    simulate: (data: SimulateRequest) =>
      request<{ success: boolean; data: SimulateResponse }>('/playground/simulate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // Alerts
  alerts: {
    getAll: (params?: { limit?: number; includeAcknowledged?: boolean; severity?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.includeAcknowledged) qs.set('include_acknowledged', 'true');
      if (params?.severity) qs.set('severity', params.severity);
      const query = qs.toString();
      return request<{ data: Alert[]; meta: { unacknowledgedCount: number } }>(`/alerts${query ? `?${query}` : ''}`);
    },
    getCount: () =>
      request<{ data: { count: number } }>('/alerts/count'),
    acknowledge: (id: number) =>
      request<{ success: boolean; data: { id: number } }>(`/alerts/${id}/acknowledge`, { method: 'POST' }),
    acknowledgeAll: () =>
      request<{ success: boolean; data: { count: number } }>('/alerts/acknowledge-all', { method: 'POST' }),
  },

  // Diagnostics — log bundle download
  downloadLogs: (params?: { target?: string; maxFiles?: number }) => {
    const qs = new URLSearchParams();
    if (params?.target) qs.set('target', params.target);
    if (params?.maxFiles) qs.set('maxFiles', String(params.maxFiles));
    const query = qs.toString();
    return request<{ success: boolean; data: LogBundle }>(`/logs/download${query ? `?${query}` : ''}`);
  },

  // Workspace skills
  workspaceSkills: {
    getAll: (workspace?: string, status?: string) => {
      const params = new URLSearchParams();
      if (workspace) params.set('workspace', workspace);
      if (status) params.set('status', status);
      const qs = params.toString();
      return request<{ data: WorkspaceSkillSummary[] }>(`/workspace-skills${qs ? `?${qs}` : ''}`);
    },
    getById: (id: string) =>
      request<{ data: WorkspaceSkillSummary }>(`/workspace-skills/${id}`),
    getPendingCount: () =>
      request<{ data: { count: number } }>('/workspace-skills/pending-count'),
    approve: (id: string) =>
      request<{ data: WorkspaceSkillSummary }>(`/workspace-skills/${id}/approve`, {
        method: 'POST',
      }),
    deny: (id: string) =>
      request<{ data: WorkspaceSkillSummary }>(`/workspace-skills/${id}/deny`, {
        method: 'POST',
      }),
    requestApproval: (id: string) =>
      request<{ data: { cloudSkillId?: string; existingDecision?: string } }>(
        `/workspace-skills/${id}/request-approval`, { method: 'POST' },
      ),
    scan: (workspacePath?: string) =>
      request<{ data: WorkspaceSkillSummary[] }>('/workspace-skills/scan', {
        method: 'POST',
        body: JSON.stringify(workspacePath ? { workspacePath } : {}),
      }),
  },

  // Workspace paths
  workspacePaths: {
    grant: (path: string, profileId?: string) =>
      request<{ success: boolean; workspacePaths: string[] }>('/workspace-paths/grant', {
        method: 'POST',
        body: JSON.stringify({ path, profileId }),
      }),
    revoke: (path: string, profileId?: string) =>
      request<{ success: boolean; workspacePaths: string[] }>('/workspace-paths/revoke', {
        method: 'POST',
        body: JSON.stringify({ path, profileId }),
      }),
  },

  // MCP servers
  mcpCapabilities: {
    get: (id: string, refresh?: boolean) =>
      request<{ data: {
        tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean } }>;
        resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
        prompts: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>;
        probedAt: string;
        error?: string;
      } }>(`/mcps/${id}/capabilities${refresh ? '?refresh=true' : ''}`),
  },
  mcps: {
    getAll: (filter?: { profileId?: string; source?: string; status?: string }) => {
      const params = new URLSearchParams();
      if (filter?.profileId) params.set('profileId', filter.profileId);
      if (filter?.source) params.set('source', filter.source);
      if (filter?.status) params.set('status', filter.status);
      const qs = params.toString();
      return request<{ data: McpServerSummary[] }>(`/mcps${qs ? `?${qs}` : ''}`);
    },
    getById: (id: string) =>
      request<{ data: McpServerSummary }>(`/mcps/${id}`),
    create: (input: CreateMcpServerRequest) =>
      request<{ data: McpServerSummary }>('/mcps', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, input: Partial<CreateMcpServerRequest>) =>
      request<{ data: McpServerSummary }>(`/mcps/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/mcps/${id}`, { method: 'DELETE' }),
    enable: (id: string) =>
      request<{ data: McpServerSummary }>(`/mcps/${id}/enable`, { method: 'POST' }),
    disable: (id: string) =>
      request<{ data: McpServerSummary }>(`/mcps/${id}/disable`, { method: 'POST' }),
    approve: (id: string) =>
      request<{ data: McpServerSummary }>(`/mcps/${id}/approve`, { method: 'POST' }),
    scan: () =>
      request<{ data: McpServerSummary[] }>('/mcps/scan', { method: 'POST' }),
  },
};
