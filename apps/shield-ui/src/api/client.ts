/**
 * API client for AgenShield daemon
 */

import type {
  HealthResponse,
  GetStatusResponse,
  GetConfigResponse,
  UpdateConfigResponse,
  UpdateConfigRequest,
  SkillAnalysis,
  SystemBinary,
  DiscoveryResult,
  AgentLinkIntegrationsListResponse,
  AgentLinkConnectedIntegrationsResponse,
  AgentLinkConnectIntegrationResponse,
} from '@agenshield/ipc';
import type {
  MarketplaceSkill,
  AnalyzeSkillRequest,
  AnalyzeSkillResponse,
  InstallSkillRequest,
} from './marketplace.types';

const BASE_URL = '/api';

const SESSION_TOKEN_KEY = 'agenshield_session_token';

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
  source: 'user' | 'workspace' | 'quarantine';
  status: 'active' | 'workspace' | 'quarantined' | 'disabled';
  description?: string;
  path: string;
}

export interface SkillDetail extends SkillSummary {
  content: string;
  metadata?: Record<string, unknown>;
  analysis?: SkillAnalysis;
}

export interface Secret {
  id: string;
  name: string;
  policyIds: string[];
  maskedValue: string;
  createdAt: string;
}

export interface CreateSecretRequest {
  name: string;
  value: string;
  policyIds: string[];
}

export interface SecurityStatus {
  level: 'high' | 'medium' | 'low';
  activePolicies: number;
  blockedRequests: number;
  totalRequests: number;
  lastIncident?: string;
}

// --- API methods ---

export const api = {
  // Existing endpoints
  getHealth: () => request<HealthResponse>('/health'),

  getStatus: () => request<GetStatusResponse>('/status'),

  getConfig: () => request<GetConfigResponse>('/config'),

  updateConfig: (data: UpdateConfigRequest) =>
    request<UpdateConfigResponse>('/config', {
      method: 'PUT',
      body: JSON.stringify(data),
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
    analyzeSkill: (data: AnalyzeSkillRequest) =>
      request<{ data: AnalyzeSkillResponse }>('/marketplace/analyze', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    installSkill: (data: InstallSkillRequest) =>
      request<{ data: { success: boolean; name: string } }>('/marketplace/install', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // System binaries & allowed commands
  getSystemBins: () =>
    request<{ data: { bins: SystemBinary[] } }>('/exec/system-bins'),

  getAllowedCommands: () =>
    request<{ data: { commands: Array<{ name: string; paths: string[]; addedAt: string; addedBy: string; category?: string }> } }>('/exec/allowed-commands'),

  // Discovery endpoint
  getDiscovery: (refresh = false) =>
    request<{ success: boolean; data: DiscoveryResult }>(`/discovery/scan?refresh=${refresh}`),

  // AgentLink endpoints
  agentlink: {
    getAuthStatus: () =>
      request<{ success: boolean; data: { authenticated: boolean; expired: boolean; expiresAt: string | null; connectedIntegrations: string[] } }>('/agentlink/auth/status'),

    startAuth: () =>
      request<{ success: boolean; data?: { authUrl?: string; message?: string }; error?: string }>('/agentlink/auth/start', {
        method: 'POST',
        body: JSON.stringify({}),
      }),

    logout: () =>
      request<{ success: boolean }>('/agentlink/auth/logout', { method: 'POST' }),

    getMCPStatus: () =>
      request<{ success: boolean; data: { state: string; active: boolean } }>('/agentlink/mcp/status'),

    listIntegrations: (category?: string, search?: string) => {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (search) params.set('search', search);
      const qs = params.toString();
      return request<{ success: boolean; data: AgentLinkIntegrationsListResponse }>(`/agentlink/integrations${qs ? `?${qs}` : ''}`);
    },

    listConnectedIntegrations: () =>
      request<{ success: boolean; data: AgentLinkConnectedIntegrationsResponse }>('/agentlink/integrations/connected'),

    connectIntegration: (integration: string, scopes?: string[]) =>
      request<{ success: boolean; data: AgentLinkConnectIntegrationResponse & { skillProvisioned?: boolean } }>('/agentlink/integrations/connect', {
        method: 'POST',
        body: JSON.stringify({ integration, scopes }),
      }),
  },
};
