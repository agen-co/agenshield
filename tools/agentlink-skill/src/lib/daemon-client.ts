/**
 * Daemon Client
 *
 * HTTP client for communicating with the AgenShield daemon.
 * All AgentLink operations are forwarded through the daemon.
 */

/** AgenShield daemon default port */
const DEFAULT_PORT = 6969;

/** AgenShield daemon default host */
const DEFAULT_HOST = 'localhost';

const DAEMON_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

/**
 * Standard response from daemon API
 */
export interface DaemonResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Make a request to the daemon API
 */
export async function daemonRequest<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<DaemonResponse<T>> {
  try {
    const url = `${DAEMON_URL}/api${path}`;
    const options: RequestInit = {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    };

    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `Daemon request failed (${response.status}): ${text}`,
      };
    }

    return (await response.json()) as DaemonResponse<T>;
  } catch (error) {
    const message = (error as Error).message;

    // Check for connection refused error
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return {
        success: false,
        error: 'AgenShield daemon is not running. Start it with: agenshield daemon start',
      };
    }

    return {
      success: false,
      error: `Failed to connect to daemon: ${message}`,
    };
  }
}

/**
 * Check if daemon is running
 */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/api/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure daemon is running, exit with error if not
 */
export async function requireDaemon(): Promise<void> {
  if (!(await isDaemonRunning())) {
    console.error('\n  Error: AgenShield daemon is not running.');
    console.log('  Start it with: agenshield daemon start\n');
    process.exit(1);
  }
}

// ===== Auth API =====

export interface AuthStartResponse {
  authUrl: string;
  state: string;
  callbackPort: number;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  expired: boolean;
  expiresAt: string | null;
  connectedIntegrations: string[];
}

export async function authStart(scopes?: string[]): Promise<DaemonResponse<AuthStartResponse>> {
  return daemonRequest<AuthStartResponse>('POST', '/agentlink/auth/start', { scopes });
}

export async function authCallback(code: string, state: string): Promise<DaemonResponse<void>> {
  return daemonRequest<void>('POST', '/agentlink/auth/callback', { code, state });
}

export async function authStatus(): Promise<DaemonResponse<AuthStatusResponse>> {
  return daemonRequest<AuthStatusResponse>('GET', '/agentlink/auth/status');
}

export async function authLogout(): Promise<DaemonResponse<void>> {
  return daemonRequest<void>('POST', '/agentlink/auth/logout');
}

// ===== Tool API =====

export interface Tool {
  integration: string;
  tool: string;
  description: string;
  connected?: boolean;
  connect_url?: string;
}

export interface ToolListResponse {
  tools: Tool[];
}

export async function toolRun(
  integration: string,
  tool: string,
  params?: Record<string, unknown>
): Promise<DaemonResponse<unknown>> {
  return daemonRequest<unknown>('POST', '/agentlink/tool/run', { integration, tool, params });
}

export async function toolList(
  integration?: string,
  connectedOnly: boolean = true
): Promise<DaemonResponse<ToolListResponse>> {
  const query = new URLSearchParams();
  if (integration) query.set('integration', integration);
  query.set('connectedOnly', String(connectedOnly));
  return daemonRequest<ToolListResponse>('GET', `/agentlink/tool/list?${query}`);
}

export async function toolSearch(
  query: string,
  integration?: string
): Promise<DaemonResponse<ToolListResponse>> {
  const params = new URLSearchParams({ query });
  if (integration) params.set('integration', integration);
  return daemonRequest<ToolListResponse>('GET', `/agentlink/tool/search?${params}`);
}

// ===== Integration API =====

export interface Integration {
  id: string;
  name: string;
  description: string;
  category: string;
  tools_count: number;
}

export interface IntegrationsListResponse {
  integrations: Integration[];
  total_count: number;
}

export interface ConnectedIntegration {
  id: string;
  name: string;
  connected_at: string;
  status: string;
  account?: string;
  requires_reauth?: boolean;
}

export interface ConnectedIntegrationsResponse {
  integrations: ConnectedIntegration[];
}

export interface ConnectIntegrationResponse {
  status: string;
  oauth_url?: string;
  expires_in?: number;
  instructions?: string;
  account?: string;
  connected_at?: string;
}

export async function integrationsList(
  category?: string,
  search?: string
): Promise<DaemonResponse<IntegrationsListResponse>> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (search) params.set('search', search);
  const query = params.toString();
  return daemonRequest<IntegrationsListResponse>('GET', `/agentlink/integrations${query ? `?${query}` : ''}`);
}

export async function integrationsConnected(): Promise<DaemonResponse<ConnectedIntegrationsResponse>> {
  return daemonRequest<ConnectedIntegrationsResponse>('GET', '/agentlink/integrations/connected');
}

export async function integrationsConnect(
  integration: string,
  scopes?: string[]
): Promise<DaemonResponse<ConnectIntegrationResponse>> {
  return daemonRequest<ConnectIntegrationResponse>('POST', '/agentlink/integrations/connect', {
    integration,
    scopes,
  });
}
