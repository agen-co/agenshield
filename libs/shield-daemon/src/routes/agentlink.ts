/**
 * AgentLink API routes
 *
 * Routes for AgentLink authentication and tool execution.
 * Tool/integration routes use the MCP client; auth routes handle OAuth.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'node:crypto';
import { MCP_GATEWAY, CALLBACK_PORT, DEFAULT_PORT } from '@agenshield/ipc';
import type {
  AgentLinkAuthStartRequest,
  AgentLinkAuthCallbackRequest,
  AgentLinkToolRunRequest,
  AgentLinkConnectIntegrationRequest,
} from '@agenshield/ipc';
import { getVault } from '../vault';
import { loadState, updateAgentLinkState, addConnectedIntegration } from '../state';
import { getMCPClient, activateMCP, deactivateMCP, getMCPState } from '../mcp';
import {
  emitAgentLinkAuthRequired,
  emitAgentLinkAuthCompleted,
} from '../events/emitter';

// Store pending auth states (in-memory, cleared on restart)
const pendingAuth = new Map<string, { codeVerifier: string; source: string; createdAt: number }>();

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

/**
 * Get the redirect URI based on the auth source
 */
function getRedirectUri(source: string, daemonPort: number): string {
  if (source === 'ui') {
    return `http://localhost:${daemonPort}/api/agentlink/auth/oauth-callback`;
  }
  return `http://localhost:${CALLBACK_PORT}/callback`;
}

/**
 * Attempt to ensure MCP client is active. Returns error info if auth is needed.
 */
async function ensureMCPActive(): Promise<{ ok: true } | { ok: false; authUrl?: string; message: string }> {
  const client = getMCPClient();
  if (client && client.isActive() && client.getState() === 'connected') {
    return { ok: true };
  }

  // Try to activate if we have valid tokens
  try {
    const token = await getValidToken();
    if (token && !client) {
      await activateMCP(() => getValidToken());
      return { ok: true };
    }
    if (client && !client.isActive()) {
      await client.activate();
      return { ok: true };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: 'Authentication required. Connect via the dashboard or run: agentlink auth login',
    };
  }
}

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
    const source = body.source || 'cli';

    // Generate PKCE
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    // Store for callback verification
    pendingAuth.set(state, { codeVerifier, source, createdAt: Date.now() });

    // Determine daemon port for redirect URI
    const addrInfo = app.server.address();
    const daemonPort = (typeof addrInfo === 'object' && addrInfo?.port) || DEFAULT_PORT;
    const redirectUri = getRedirectUri(source, daemonPort);

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
      const redirectUris = [
        `http://localhost:${CALLBACK_PORT}/callback`,
        `http://localhost:${daemonPort}/api/agentlink/auth/oauth-callback`,
      ];

      const dcrResponse = await fetch(`${MCP_GATEWAY}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: `AgenShield-${crypto.randomBytes(4).toString('hex')}`,
          redirect_uris: redirectUris,
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
    authUrl.searchParams.set('redirect_uri', redirectUri);
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
        callbackPort: source === 'ui' ? daemonPort : CALLBACK_PORT,
      },
    };
  });

  /**
   * OAuth callback endpoint — handles redirect from OAuth provider (UI popup flow)
   */
  app.get('/agentlink/auth/oauth-callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { code, state, error: oauthError } = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      return reply.type('text/html').send(`
        <html><body style="font-family: system-ui; text-align: center; padding-top: 80px;">
          <h2>Authentication Failed</h2>
          <p>${oauthError}</p>
          <script>setTimeout(() => window.close(), 3000)</script>
        </body></html>
      `);
    }

    if (!code || !state) {
      return reply.type('text/html').send(`
        <html><body style="font-family: system-ui; text-align: center; padding-top: 80px;">
          <h2>Invalid Callback</h2>
          <p>Missing code or state parameter.</p>
          <script>setTimeout(() => window.close(), 3000)</script>
        </body></html>
      `);
    }

    // Validate state
    const pending = pendingAuth.get(state);
    if (!pending) {
      return reply.type('text/html').send(`
        <html><body style="font-family: system-ui; text-align: center; padding-top: 80px;">
          <h2>Invalid State</h2>
          <p>Authentication session expired. Please try again.</p>
          <script>setTimeout(() => window.close(), 3000)</script>
        </body></html>
      `);
    }
    pendingAuth.delete(state);

    // Get client credentials from vault
    const vault = getVault();
    const existing = await vault.get('agentlink');
    if (!existing?.clientId || !existing?.clientSecret) {
      return reply.type('text/html').send(`
        <html><body style="font-family: system-ui; text-align: center; padding-top: 80px;">
          <h2>Configuration Error</h2>
          <p>No client credentials found. Please start the auth flow again.</p>
          <script>setTimeout(() => window.close(), 3000)</script>
        </body></html>
      `);
    }

    // Determine redirect URI used for this auth
    const addrInfo = app.server.address();
    const daemonPort = (typeof addrInfo === 'object' && addrInfo?.port) || DEFAULT_PORT;
    const redirectUri = getRedirectUri(pending.source, daemonPort);

    // Exchange code for tokens
    const tokenResponse = await fetch(`${MCP_GATEWAY}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: existing.clientId,
        client_secret: existing.clientSecret,
        redirect_uri: redirectUri,
        code_verifier: pending.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      return reply.type('text/html').send(`
        <html><body style="font-family: system-ui; text-align: center; padding-top: 80px;">
          <h2>Token Exchange Failed</h2>
          <p>${tokenError}</p>
          <script>setTimeout(() => window.close(), 3000)</script>
        </body></html>
      `);
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

    // Activate MCP client
    try {
      await activateMCP(() => getValidToken());
    } catch {
      // MCP activation failure shouldn't block auth success
    }

    // Broadcast auth completed SSE event
    emitAgentLinkAuthCompleted();

    // Return success HTML that auto-closes the popup
    return reply.type('text/html').send(`
      <html><body style="font-family: system-ui; text-align: center; padding-top: 80px;">
        <h2 style="color: #16a34a;">Authentication Successful</h2>
        <p>You can close this window. Your credentials are stored securely.</p>
        <script>setTimeout(() => window.close(), 2000)</script>
      </body></html>
    `);
  });

  /**
   * Complete OAuth flow with callback code (CLI / agent flow)
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

    // Determine redirect URI used for this auth
    const addrInfo = app.server.address();
    const daemonPort = (typeof addrInfo === 'object' && addrInfo?.port) || DEFAULT_PORT;
    const redirectUri = getRedirectUri(pending.source, daemonPort);

    // Exchange code for tokens
    const tokenResponse = await fetch(`${MCP_GATEWAY}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: existing.clientId,
        client_secret: existing.clientSecret,
        redirect_uri: redirectUri,
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

    // Activate MCP client
    try {
      await activateMCP(() => getValidToken());
    } catch {
      // MCP activation failure shouldn't block auth success
    }

    // Broadcast auth completed SSE event
    emitAgentLinkAuthCompleted();

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
    // Deactivate MCP client first
    await deactivateMCP();

    const vault = getVault();
    await vault.delete('agentlink');

    updateAgentLinkState({
      authenticated: false,
      lastAuthAt: undefined,
      connectedIntegrations: [],
    });

    return { success: true };
  });

  // ===== MCP STATUS ROUTES =====

  /**
   * Activate MCP client connection
   */
  app.post('/agentlink/mcp/activate', async () => {
    try {
      await activateMCP(() => getValidToken());
      return { success: true, data: { state: getMCPState(), active: true } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Deactivate MCP client connection
   */
  app.post('/agentlink/mcp/deactivate', async () => {
    await deactivateMCP();
    return { success: true, data: { state: getMCPState(), active: false } };
  });

  /**
   * Get MCP connection status
   */
  app.get('/agentlink/mcp/status', async () => {
    const client = getMCPClient();
    return {
      success: true,
      data: {
        state: getMCPState(),
        active: client?.isActive() ?? false,
      },
    };
  });

  // ===== TOOL ROUTES =====

  /**
   * Run a tool via MCP client
   */
  app.post('/agentlink/tool/run', async (request) => {
    const { integration, tool, params = {} } = request.body as AgentLinkToolRunRequest;

    const mcpStatus = await ensureMCPActive();
    if (!mcpStatus.ok) {
      // Broadcast auth required event for UI delegation
      const addrInfo = app.server.address();
      const daemonPort = (typeof addrInfo === 'object' && addrInfo?.port) || DEFAULT_PORT;

      // Start auth flow for agent delegation
      try {
        const authRes = await startAuthForDelegation(app, daemonPort);
        emitAgentLinkAuthRequired(authRes.authUrl, integration);
        return {
          success: false,
          error: 'auth_required',
          data: { authUrl: authRes.authUrl, message: mcpStatus.message },
        };
      } catch {
        return { success: false, error: 'auth_required', data: { message: mcpStatus.message } };
      }
    }

    try {
      const client = getMCPClient()!;
      const toolName = `${integration}_${tool}`;
      const result = await client.callTool(toolName, params);

      if (result.isError) {
        const errorText = result.content.map((c) => c.text || '').join('\n');
        return { success: false, error: errorText };
      }

      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List available tools via MCP client
   */
  app.get('/agentlink/tool/list', async (request) => {
    const { integration, connectedOnly } = request.query as { integration?: string; connectedOnly?: string };

    const mcpStatus = await ensureMCPActive();
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      let tools = await client.listTools();

      if (integration) {
        tools = tools.filter((t) => t.integration === integration || t.name.startsWith(`${integration}_`));
      }

      return { success: true, data: { tools } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Search tools via MCP client
   */
  app.get('/agentlink/tool/search', async (request) => {
    const { query, integration } = request.query as { query?: string; integration?: string };

    if (!query) {
      return { success: false, error: 'Query parameter is required' };
    }

    const mcpStatus = await ensureMCPActive();
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      let tools = await client.listTools();

      // Filter by query
      const lowerQuery = query.toLowerCase();
      tools = tools.filter(
        (t) =>
          t.name.toLowerCase().includes(lowerQuery) ||
          t.description.toLowerCase().includes(lowerQuery)
      );

      if (integration) {
        tools = tools.filter((t) => t.integration === integration || t.name.startsWith(`${integration}_`));
      }

      return { success: true, data: { tools } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ===== INTEGRATION ROUTES =====

  /**
   * List available integrations via MCP client
   */
  app.get('/agentlink/integrations', async (request) => {
    const { category, search } = request.query as { category?: string; search?: string };

    const mcpStatus = await ensureMCPActive();
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('list_available_integrations', { category, search });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List connected integrations via MCP client
   */
  app.get('/agentlink/integrations/connected', async () => {
    const mcpStatus = await ensureMCPActive();
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('list_connected_integrations', {});
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Connect an integration via MCP client
   */
  app.post('/agentlink/integrations/connect', async (request) => {
    const { integration, scopes } = request.body as AgentLinkConnectIntegrationRequest;

    const mcpStatus = await ensureMCPActive();
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const params: Record<string, unknown> = { integration };
      if (scopes) params.scopes = scopes;

      const result = await client.callTool('connect_integration', params);
      const resultData = result.content?.[0]?.data as { status?: string } | undefined;

      // Track connected integration
      if (resultData?.status === 'already_connected' || resultData?.status === 'connected') {
        addConnectedIntegration(integration);
      }

      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}

/**
 * Start auth flow for agent delegation (used when MCP client is not active)
 */
async function startAuthForDelegation(
  app: FastifyInstance,
  daemonPort: number
): Promise<{ authUrl: string }> {
  const scopes = ['openid', 'profile', 'mcp:read', 'mcp:write'];
  const source = 'agent';

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  pendingAuth.set(state, { codeVerifier, source, createdAt: Date.now() });

  const vault = getVault();
  const existing = await vault.get('agentlink');

  if (!existing?.clientId) {
    throw new Error('No client credentials. Start auth flow first.');
  }

  const redirectUri = getRedirectUri(source, daemonPort);

  const authUrl = new URL(`${MCP_GATEWAY}/oauth/authorize`);
  authUrl.searchParams.set('client_id', existing.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return { authUrl: authUrl.toString() };
}
