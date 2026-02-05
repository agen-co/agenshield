/**
 * AgentLink API routes
 *
 * Routes for AgentLink authentication and tool execution.
 * Tool/integration routes use the MCP client; auth routes handle OAuth
 * via the official MCP SDK (DCR, PKCE, token exchange, refresh are automatic).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_PORT } from '@agenshield/ipc';
import type {
  AgentLinkConnectIntegrationRequest,
  AgentLinkIntegrationsListResponse,
  AgentLinkConnectedIntegrationsResponse,
  AgentLinkConnectIntegrationResponse,
} from '@agenshield/ipc';
import { getVault } from '../vault';
import { loadState, updateAgentLinkState, addConnectedIntegration } from '../state';
import { getMCPClient, activateMCP, deactivateMCP, getMCPState, finishMCPAuth } from '../mcp';
import { emitAgentLinkAuthRequired } from '../events/emitter';
import { provisionAgentLinkSkill } from '../services/integration-skills';

/**
 * Extract parsed JSON from an MCP tool result.
 * MCP returns { content: [{ type: "text", text: "..." }] } — we parse the text.
 */
function extractToolResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content
    ?.filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('');
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * Get daemon port from Fastify server address
 */
function getDaemonPort(app: FastifyInstance): number {
  const addrInfo = app.server.address();
  return (typeof addrInfo === 'object' && addrInfo?.port) || DEFAULT_PORT;
}

/**
 * Attempt to ensure MCP client is active. Returns error info if auth is needed.
 */
async function ensureMCPActive(app: FastifyInstance): Promise<{ ok: true } | { ok: false; authUrl?: string; message: string }> {
  const client = getMCPClient();
  if (client && client.isActive() && client.getState() === 'connected') {
    return { ok: true };
  }

  try {
    const daemonPort = getDaemonPort(app);
    const result = await activateMCP(daemonPort);
    if (result.authUrl) {
      return { ok: false, authUrl: result.authUrl, message: 'Authentication required' };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'Failed to connect' };
  }
}

/**
 * Map raw MCP result → AgentLinkIntegrationsListResponse
 */
function mapIntegrationsList(raw: unknown): AgentLinkIntegrationsListResponse {
  const items = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.integrations ?? [];
  const integrations = (items as Record<string, unknown>[]).map((i) => ({
    id: (i.id ?? i.integrationId ?? (i.name as string)?.toLowerCase() ?? '') as string,
    name: (i.name ?? i.displayName ?? i.id ?? '') as string,
    description: (i.description ?? '') as string,
    category: (i.category ?? 'other') as string,
    toolsCount: (i.toolsCount ?? i.tools_count ?? i.toolCount ?? 0) as number,
  }));
  return { integrations, totalCount: integrations.length };
}

/**
 * Map raw MCP result → AgentLinkConnectedIntegrationsResponse
 */
function mapConnectedIntegrations(raw: unknown): AgentLinkConnectedIntegrationsResponse {
  const items = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.integrations ?? [];
  const integrations = (items as Record<string, unknown>[]).map((i) => ({
    id: (i.id ?? i.integrationId ?? (i.name as string)?.toLowerCase() ?? '') as string,
    name: (i.name ?? i.displayName ?? i.id ?? '') as string,
    connectedAt: (i.connectedAt ?? i.connected_at ?? new Date().toISOString()) as string,
    status: (i.status ?? 'active') as string,
    account: (i.account ?? i.accountName) as string | undefined,
    requiresReauth: (i.requiresReauth ?? i.requires_reauth ?? false) as boolean,
  }));
  return { integrations };
}

/**
 * Map raw MCP result → AgentLinkConnectIntegrationResponse
 */
function mapConnectResponse(raw: unknown): AgentLinkConnectIntegrationResponse {
  const r = raw as Record<string, unknown>;
  return {
    status: (r.status ?? 'auth_required') as AgentLinkConnectIntegrationResponse['status'],
    oauthUrl: (r.oauthUrl ?? r.oauth_url ?? r.authUrl ?? r.auth_url) as string | undefined,
    expiresIn: r.expiresIn as number | undefined,
    instructions: r.instructions as string | undefined,
    account: (r.account ?? r.accountName) as string | undefined,
    connectedAt: (r.connectedAt ?? r.connected_at) as string | undefined,
  };
}

/**
 * Register AgentLink routes
 */
export async function agentlinkRoutes(app: FastifyInstance): Promise<void> {
  // ===== AUTH ROUTES =====

  /**
   * Start OAuth authentication flow.
   * The SDK handles DCR, PKCE, and authorization URL generation automatically.
   */
  app.post('/agentlink/auth/start', async () => {
    const daemonPort = getDaemonPort(app);

    try {
      const result = await activateMCP(daemonPort);
      if (result.authUrl) {
        return { success: true, data: { authUrl: result.authUrl } };
      }
      return { success: true, data: { message: 'Already connected' } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * OAuth callback endpoint — handles redirect from OAuth provider (UI popup flow).
   * The SDK exchanges the code for tokens automatically via finishAuth().
   */
  app.get('/agentlink/auth/oauth-callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { code, error: oauthError } = request.query as {
      code?: string;
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

    if (!code) {
      return reply.type('text/html').send(`
        <html><body style="font-family: system-ui; text-align: center; padding-top: 80px;">
          <h2>Invalid Callback</h2>
          <p>Missing authorization code.</p>
          <script>setTimeout(() => window.close(), 3000)</script>
        </body></html>
      `);
    }

    try {
      await finishMCPAuth(code);

      // Update system state
      updateAgentLinkState({
        authenticated: true,
        lastAuthAt: new Date().toISOString(),
      });

      // Redirect back to the UI integrations page
      return reply.type('text/html').send(`
        <html><body style="font-family: system-ui; text-align: center; padding-top: 80px;">
          <h2 style="color: #16a34a;">Authentication Successful</h2>
          <p>Redirecting back to AgenShield…</p>
          <script>window.location.href = '/integrations';</script>
        </body></html>
      `);
    } catch (err) {
      return reply.type('text/html').send(`
        <html><body style="font-family: system-ui; text-align: center; padding-top: 80px;">
          <h2>Authentication Failed</h2>
          <p>${(err as Error).message}</p>
          <p><a href="/integrations">Back to Integrations</a></p>
        </body></html>
      `);
    }
  });

  /**
   * Complete OAuth flow with callback code (CLI / agent flow).
   * The SDK exchanges the code for tokens automatically via finishAuth().
   */
  app.post('/agentlink/auth/callback', async (request) => {
    const { code } = request.body as { code?: string };

    if (!code) {
      return { success: false, error: 'Missing authorization code' };
    }

    try {
      await finishMCPAuth(code);

      // Update system state
      updateAgentLinkState({
        authenticated: true,
        lastAuthAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
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
      const daemonPort = getDaemonPort(app);
      const result = await activateMCP(daemonPort);
      return { success: true, data: { state: getMCPState(), active: true, authUrl: result.authUrl } };
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
   * Run a tool via MCP gateway's `call-tool` meta-tool.
   * The gateway wraps integration-specific tools behind `call-tool`.
   */
  app.post('/agentlink/tool/run', async (request) => {
    const { toolName, input = {} } = request.body as { toolName: string; input?: Record<string, unknown> };

    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      if (mcpStatus.authUrl) {
        emitAgentLinkAuthRequired(mcpStatus.authUrl);
      }
      return {
        success: false,
        error: 'auth_required',
        data: { authUrl: mcpStatus.authUrl, message: mcpStatus.message },
      };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('call-tool', { toolName, input });

      if (result.isError) {
        const errorText = result.content.map((c) => c.text || '').join('\n');
        return { success: false, error: errorText };
      }

      return { success: true, data: extractToolResult(result) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List MCP gateway tools (meta-tools like search-tools, call-tool, etc.)
   */
  app.get('/agentlink/tool/list', async () => {
    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const tools = await client.listTools();
      return { success: true, data: { tools } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Search integration tools via MCP gateway's `search-tools`.
   * Discovers integration-specific tools by query (e.g. "send email", "list repos").
   */
  app.get('/agentlink/tool/search', async (request) => {
    const { query } = request.query as { query?: string };

    if (!query) {
      return { success: false, error: 'Query parameter is required' };
    }

    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('search-tools', { queries: [query] });
      return { success: true, data: extractToolResult(result) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ===== INTEGRATION ROUTES =====

  /**
   * List available integrations via MCP gateway
   */
  app.get('/agentlink/integrations', async () => {
    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('list-available-integrations', {});
      const raw = extractToolResult(result);
      return { success: true, data: mapIntegrationsList(raw) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List connected integrations via MCP gateway
   */
  app.get('/agentlink/integrations/connected', async () => {
    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('list-connected-integrations', {});
      const raw = extractToolResult(result);
      return { success: true, data: mapConnectedIntegrations(raw) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Get OAuth auth URL for an integration via MCP gateway.
   * If already connected, auto-provision matching built-in skills.
   */
  app.post('/agentlink/integrations/connect', async (request) => {
    const { integration } = request.body as AgentLinkConnectIntegrationRequest;

    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('get-integration-auth-url', { integrationId: integration });
      const parsed = mapConnectResponse(extractToolResult(result));

      if (parsed.status === 'already_connected' || parsed.status === 'connected') {
        addConnectedIntegration(integration);
        // Provision the agentlink-secure-integrations skill (handles all integrations)
        const { installed } = await provisionAgentLinkSkill();
        return {
          success: true,
          data: { ...parsed, skillProvisioned: installed },
        };
      }

      return { success: true, data: parsed };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

}
