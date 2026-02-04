/**
 * AgentLink API routes
 *
 * Routes for AgentLink authentication and tool execution.
 * All requests are forwarded to the MCP Gateway.
 */

import type { FastifyInstance } from 'fastify';
import * as crypto from 'node:crypto';
import { MCP_GATEWAY, CALLBACK_PORT } from '@agenshield/ipc';
import type {
  AgentLinkAuthStartRequest,
  AgentLinkAuthCallbackRequest,
  AgentLinkToolRunRequest,
  AgentLinkConnectIntegrationRequest,
} from '@agenshield/ipc';
import { getVault } from '../vault';
import { loadState, updateAgentLinkState, addConnectedIntegration } from '../state';

// Store pending auth states (in-memory, cleared on restart)
const pendingAuth = new Map<string, { codeVerifier: string; createdAt: number }>();

// Clean up old pending auth states periodically (5 minutes)
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  for (const [state, data] of pendingAuth) {
    if (now - data.createdAt > maxAge) {
      pendingAuth.delete(state);
    }
  }
}, 5 * 60 * 1000);

/**
 * Register AgentLink routes
 */
export async function agentlinkRoutes(app: FastifyInstance): Promise<void> {
  // ===== AUTH ROUTES =====

  /**
   * Start OAuth authentication flow
   */
  app.post('/agentlink/auth/start', async (request) => {
    const body = (request.body as AgentLinkAuthStartRequest) || {};
    const scopes = body.scopes || ['openid', 'profile', 'mcp:read', 'mcp:write'];

    // Generate PKCE
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    // Store for callback verification
    pendingAuth.set(state, { codeVerifier, createdAt: Date.now() });

    // Check if we have existing client credentials in vault
    const vault = getVault();
    let clientId: string;
    let clientSecret: string;

    const existing = await vault.get('agentlink');
    if (existing?.clientId && existing?.clientSecret) {
      clientId = existing.clientId;
      clientSecret = existing.clientSecret;
    } else {
      // Perform Dynamic Client Registration
      const dcrResponse = await fetch(`${MCP_GATEWAY}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: `AgenShield-${crypto.randomBytes(4).toString('hex')}`,
          redirect_uris: [`http://localhost:${CALLBACK_PORT}/callback`],
          grant_types: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_method: 'client_secret_post',
        }),
      });

      if (!dcrResponse.ok) {
        const error = await dcrResponse.text();
        return { success: false, error: `Client registration failed: ${error}` };
      }

      const dcr = (await dcrResponse.json()) as { client_id: string; client_secret: string };
      clientId = dcr.client_id;
      clientSecret = dcr.client_secret;

      // Store client credentials in vault
      await vault.set('agentlink', {
        clientId,
        clientSecret,
        accessToken: '',
        refreshToken: '',
        expiresAt: 0,
      });
    }

    // Build authorization URL
    const authUrl = new URL(`${MCP_GATEWAY}/oauth/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', `http://localhost:${CALLBACK_PORT}/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return {
      success: true,
      data: {
        authUrl: authUrl.toString(),
        state,
        callbackPort: CALLBACK_PORT,
      },
    };
  });

  /**
   * Complete OAuth flow with callback code
   */
  app.post('/agentlink/auth/callback', async (request) => {
    const { code, state } = request.body as AgentLinkAuthCallbackRequest;

    // Validate state
    const pending = pendingAuth.get(state);
    if (!pending) {
      return { success: false, error: 'Invalid or expired state parameter' };
    }
    pendingAuth.delete(state);

    // Get client credentials from vault
    const vault = getVault();
    const existing = await vault.get('agentlink');
    if (!existing?.clientId || !existing?.clientSecret) {
      return { success: false, error: 'No client credentials found. Start auth flow again.' };
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(`${MCP_GATEWAY}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: existing.clientId,
        client_secret: existing.clientSecret,
        redirect_uri: `http://localhost:${CALLBACK_PORT}/callback`,
        code_verifier: pending.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      return { success: false, error: `Token exchange failed: ${error}` };
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Store tokens in vault
    await vault.set('agentlink', {
      ...existing,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });

    // Update system state
    updateAgentLinkState({
      authenticated: true,
      lastAuthAt: new Date().toISOString(),
    });

    return { success: true };
  });

  /**
   * Get authentication status
   */
  app.get('/agentlink/auth/status', async () => {
    const vault = getVault();
    const agentlink = await vault.get('agentlink');
    const state = loadState();

    const hasToken = !!agentlink?.accessToken;
    const isExpired = agentlink?.expiresAt ? agentlink.expiresAt < Date.now() : true;

    return {
      success: true,
      data: {
        authenticated: hasToken && !isExpired,
        expired: hasToken && isExpired,
        expiresAt: agentlink?.expiresAt ? new Date(agentlink.expiresAt).toISOString() : null,
        connectedIntegrations: state.agentlink.connectedIntegrations,
      },
    };
  });

  /**
   * Logout and clear credentials
   */
  app.post('/agentlink/auth/logout', async () => {
    const vault = getVault();
    await vault.delete('agentlink');

    updateAgentLinkState({
      authenticated: false,
      lastAuthAt: undefined,
      connectedIntegrations: [],
    });

    return { success: true };
  });

  // ===== TOOL ROUTES =====

  /**
   * Run a tool
   */
  app.post('/agentlink/tool/run', async (request) => {
    const { integration, tool, params = {} } = request.body as AgentLinkToolRunRequest;

    try {
      const token = await getValidToken();

      const response = await fetch(`${MCP_GATEWAY}/mcp/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now().toString(),
          method: 'execute_tool',
          params: { integration, tool, arguments: params },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `MCP request failed: ${error}` };
      }

      const result = (await response.json()) as { result?: unknown; error?: { message?: string } };

      if (result.error) {
        return { success: false, error: result.error.message || JSON.stringify(result.error) };
      }

      return { success: true, data: result.result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List available tools
   */
  app.get('/agentlink/tool/list', async (request) => {
    const { integration, connectedOnly } = request.query as { integration?: string; connectedOnly?: string };

    try {
      const token = await getValidToken();

      const response = await fetch(`${MCP_GATEWAY}/mcp/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now().toString(),
          method: 'search_tools',
          params: {
            connected_only: connectedOnly === 'true',
            integration,
          },
        }),
      });

      const result = (await response.json()) as { result?: unknown };
      return { success: true, data: result.result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Search tools
   */
  app.get('/agentlink/tool/search', async (request) => {
    const { query, integration } = request.query as { query?: string; integration?: string };

    if (!query) {
      return { success: false, error: 'Query parameter is required' };
    }

    try {
      const token = await getValidToken();

      const response = await fetch(`${MCP_GATEWAY}/mcp/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now().toString(),
          method: 'search_tools',
          params: {
            query,
            integration,
            connected_only: false,
          },
        }),
      });

      const result = (await response.json()) as { result?: unknown };
      return { success: true, data: result.result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ===== INTEGRATION ROUTES =====

  /**
   * List available integrations
   */
  app.get('/agentlink/integrations', async (request) => {
    const { category, search } = request.query as { category?: string; search?: string };

    try {
      const token = await getValidToken();

      const response = await fetch(`${MCP_GATEWAY}/mcp/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now().toString(),
          method: 'list_available_integrations',
          params: { category, search },
        }),
      });

      const result = (await response.json()) as { result?: unknown };
      return { success: true, data: result.result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List connected integrations
   */
  app.get('/agentlink/integrations/connected', async () => {
    try {
      const token = await getValidToken();

      const response = await fetch(`${MCP_GATEWAY}/mcp/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now().toString(),
          method: 'list_connected_integrations',
          params: {},
        }),
      });

      const result = (await response.json()) as { result?: unknown };
      return { success: true, data: result.result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Connect an integration
   */
  app.post('/agentlink/integrations/connect', async (request) => {
    const { integration, scopes } = request.body as AgentLinkConnectIntegrationRequest;

    try {
      const token = await getValidToken();

      const params: Record<string, unknown> = { integration };
      if (scopes) {
        params.scopes = scopes;
      }

      const response = await fetch(`${MCP_GATEWAY}/mcp/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now().toString(),
          method: 'connect_integration',
          params,
        }),
      });

      const result = (await response.json()) as {
        result?: {
          status: string;
          oauth_url?: string;
          account?: string;
          connected_at?: string;
        };
        error?: { message?: string };
      };

      if (result.error) {
        return { success: false, error: result.error.message };
      }

      // Track connected integration
      if (result.result?.status === 'already_connected' || result.result?.status === 'connected') {
        addConnectedIntegration(integration);
      }

      return { success: true, data: result.result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}

/**
 * Get a valid access token, refreshing if necessary
 */
async function getValidToken(): Promise<string> {
  const vault = getVault();
  const agentlink = await vault.get('agentlink');

  if (!agentlink?.accessToken) {
    throw new Error('Not authenticated. Run: agentlink auth');
  }

  // Check if token is still valid (with 5 min buffer)
  if (agentlink.expiresAt > Date.now() + 5 * 60 * 1000) {
    return agentlink.accessToken;
  }

  // Need to refresh token
  const response = await fetch(`${MCP_GATEWAY}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: agentlink.refreshToken,
      client_id: agentlink.clientId,
      client_secret: agentlink.clientSecret,
    }),
  });

  if (!response.ok) {
    // Clear invalid tokens
    await vault.delete('agentlink');
    updateAgentLinkState({ authenticated: false });
    throw new Error('Token refresh failed. Run: agentlink auth');
  }

  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Store updated tokens
  await vault.set('agentlink', {
    ...agentlink,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || agentlink.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });

  return tokens.access_token;
}
