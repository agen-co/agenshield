/**
 * AgenCo API routes
 *
 * Routes for AgenCo authentication and tool execution.
 * Tool/integration routes use the MCP client; auth routes handle OAuth
 * via the official MCP SDK (DCR, PKCE, token exchange, refresh are automatic).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DEFAULT_PORT, MARKETPLACE_API } from '@agenshield/ipc';
import { loggedFetch } from '../utils/logged-fetch';
import type {
  AgenCoConnectIntegrationRequest,
  AgenCoIntegrationsListResponse,
  AgenCoConnectedIntegrationsResponse,
  AgenCoConnectIntegrationResponse,
} from '@agenshield/ipc';
import { getVault } from '../vault';
import { loadState, updateAgenCoState, addConnectedIntegration, removeConnectedIntegration } from '../state';
import { getMCPClient, activateMCP, deactivateMCP, getMCPState, finishMCPAuth, MCPUnauthorizedError } from '../mcp';
import { emitAgenCoAuthRequired } from '../events/emitter';
import { INTEGRATION_CATALOG, type IntegrationDetails } from '../data/integration-catalog';

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
async function ensureMCPActive(app: FastifyInstance): Promise<{ ok: true } | { ok: false; error?: string; authUrl?: string; message: string }> {
  const client = getMCPClient();

  if (client && client.isActive()) {
    const state = client.getState();

    if (state === 'connected') {
      return { ok: true };
    }

    if (state === 'unauthorized') {
      return { ok: false, error: 'unauthorized', message: 'Session expired or unauthorized. Please re-authenticate via the Shield UI.' };
    }
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
 * Map MCP available-integration IDs to static catalog details.
 * Enriches each ID with title, description, actions from the catalog.
 */
function mapIntegrationsList(availableIds: string[], search?: string): AgenCoIntegrationsListResponse {
  let integrations = availableIds
    .map((id) => {
      const details: IntegrationDetails | undefined = INTEGRATION_CATALOG[id];
      return {
        id,
        name: details?.title ?? slugToDisplayName(id),
        description: details?.description ?? '',
        category: 'other',
        toolsCount: details?.actions.length ?? 0,
        actions: details?.actions ?? [],
      };
    });

  if (search) {
    const q = search.toLowerCase();
    integrations = integrations.filter(
      (i) =>
        i.id.includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.actions.some((a) => a.name.includes(q) || a.description.toLowerCase().includes(q)),
    );
  }

  return { integrations, totalCount: integrations.length };
}

/**
 * Convert a slug like "google-calendar" to display name "Google Calendar"
 */
function slugToDisplayName(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Map raw MCP result → AgenCoConnectedIntegrationsResponse
 *
 * The MCP tool `list-connected-integrations` may return:
 *   - { integrations: ["google-calendar", "slack"], count: N }  (string array)
 *   - { integrations: [{ id, name, ... }], count: N }          (object array)
 *   - ["google-calendar", "slack"]                              (plain array)
 */
function mapConnectedIntegrations(raw: unknown): AgenCoConnectedIntegrationsResponse {
  const items = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.integrations ?? [];
  const integrations = (items as unknown[]).map((i) => {
    // Handle string items — MCP returns ["google-calendar", "slack"]
    if (typeof i === 'string') {
      return {
        id: i,
        name: slugToDisplayName(i),
        connectedAt: new Date().toISOString(),
        status: 'active',
        account: undefined,
        requiresReauth: false,
      };
    }
    // Handle object items (full metadata)
    const obj = i as Record<string, unknown>;
    const id = (obj.id ?? obj.integrationId ?? (obj.name as string)?.toLowerCase() ?? '') as string;
    return {
      id,
      name: (obj.name ?? obj.displayName ?? slugToDisplayName(id)) as string,
      connectedAt: (obj.connectedAt ?? obj.connected_at ?? new Date().toISOString()) as string,
      status: (obj.status ?? 'active') as string,
      account: (obj.account ?? obj.accountName) as string | undefined,
      requiresReauth: (obj.requiresReauth ?? obj.requires_reauth ?? false) as boolean,
    };
  });
  return { integrations };
}

/**
 * Map raw MCP result → AgenCoConnectIntegrationResponse
 */
function mapConnectResponse(raw: unknown): AgenCoConnectIntegrationResponse {
  const r = raw as Record<string, unknown>;
  return {
    status: (r.status ?? 'auth_required') as AgenCoConnectIntegrationResponse['status'],
    oauthUrl: (r.oauthUrl ?? r.oauth_url ?? r.authUrl ?? r.auth_url) as string | undefined,
    expiresIn: r.expiresIn as number | undefined,
    instructions: r.instructions as string | undefined,
    account: (r.account ?? r.accountName) as string | undefined,
    connectedAt: (r.connectedAt ?? r.connected_at) as string | undefined,
  };
}

/**
 * Register AgenCo routes
 */
export async function agencoRoutes(app: FastifyInstance): Promise<void> {
  // ===== AUTH ROUTES =====

  /**
   * Start OAuth authentication flow.
   * The SDK handles DCR, PKCE, and authorization URL generation automatically.
   */
  app.post('/agenco/auth/start', async () => {
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
  app.get('/agenco/auth/oauth-callback', async (request: FastifyRequest, reply: FastifyReply) => {
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
      updateAgenCoState({
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
  app.post('/agenco/auth/callback', async (request) => {
    const { code } = request.body as { code?: string };

    if (!code) {
      return { success: false, error: 'Missing authorization code' };
    }

    try {
      await finishMCPAuth(code);

      // Update system state
      updateAgenCoState({
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
  app.get('/agenco/auth/status', async () => {
    const vault = getVault();
    const agenco = await vault.get('agenco');
    const state = loadState();

    const hasToken = !!agenco?.accessToken;
    const isExpired = agenco?.expiresAt ? agenco.expiresAt < Date.now() : true;

    return {
      success: true,
      data: {
        authenticated: hasToken && !isExpired,
        expired: hasToken && isExpired,
        expiresAt: agenco?.expiresAt ? new Date(agenco.expiresAt).toISOString() : null,
        connectedIntegrations: state.agenco.connectedIntegrations,
      },
    };
  });

  /**
   * Logout and clear credentials
   */
  app.post('/agenco/auth/logout', async () => {
    // Deactivate MCP client first
    await deactivateMCP();

    const vault = getVault();
    await vault.delete('agenco');

    updateAgenCoState({
      authenticated: false,
      lastAuthAt: undefined,
      connectedIntegrations: [],
    });

    // Sync skills — removes all AgenCo skills since connectedIntegrations is now empty
    try {
      await app.skillManager.syncSource('mcp', 'openclaw');
    } catch { /* non-fatal */ }

    return { success: true };
  });

  // ===== MCP STATUS ROUTES =====

  /**
   * Activate MCP client connection
   */
  app.post('/agenco/mcp/activate', async () => {
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
  app.post('/agenco/mcp/deactivate', async () => {
    await deactivateMCP();
    return { success: true, data: { state: getMCPState(), active: false } };
  });

  /**
   * Get MCP connection status
   */
  app.get('/agenco/mcp/status', async () => {
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
   * Generic MCP tool passthrough (used by agenco CLI).
   * Forwards directly to any MCP tool by name.
   */
  app.post('/agenco/mcp/call', async (request) => {
    const { tool, input = {} } = request.body as { tool: string; input?: Record<string, unknown> };

    if (!tool) {
      return { success: false, error: 'Missing "tool" parameter' };
    }

    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      if (mcpStatus.error === 'unauthorized') {
        return { success: false, error: 'unauthorized', data: { message: mcpStatus.message } };
      }
      if (mcpStatus.authUrl) emitAgenCoAuthRequired(mcpStatus.authUrl);
      return { success: false, error: 'auth_required', data: { authUrl: mcpStatus.authUrl, message: mcpStatus.message } };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool(tool, input);
      if (result.isError) {
        return { success: false, error: result.content.map((c) => c.text || '').join('\n') };
      }
      return { success: true, data: extractToolResult(result) };
    } catch (error) {
      if (error instanceof MCPUnauthorizedError) {
        return { success: false, error: 'unauthorized', data: { message: error.message } };
      }
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Run a tool via MCP gateway's `call-tool` meta-tool.
   * The gateway wraps integration-specific tools behind `call-tool`.
   */
  app.post('/agenco/tool/run', async (request) => {
    const { toolName, input = {} } = request.body as { toolName: string; input?: Record<string, unknown> };

    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      if (mcpStatus.error === 'unauthorized') {
        return { success: false, error: 'unauthorized', data: { message: mcpStatus.message } };
      }
      if (mcpStatus.authUrl) {
        emitAgenCoAuthRequired(mcpStatus.authUrl);
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
      if (error instanceof MCPUnauthorizedError) {
        return { success: false, error: 'unauthorized', data: { message: error.message } };
      }
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List MCP gateway tools (meta-tools like search-tools, call-tool, etc.)
   */
  app.get('/agenco/tool/list', async () => {
    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      if (mcpStatus.error === 'unauthorized') {
        return { success: false, error: 'unauthorized', data: { message: mcpStatus.message } };
      }
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const tools = await client.listTools();
      return { success: true, data: { tools } };
    } catch (error) {
      if (error instanceof MCPUnauthorizedError) {
        return { success: false, error: 'unauthorized', data: { message: error.message } };
      }
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Search integration tools via MCP gateway's `search-tools`.
   * Discovers integration-specific tools by query (e.g. "send email", "list repos").
   */
  app.get('/agenco/tool/search', async (request) => {
    const { query } = request.query as { query?: string };

    if (!query) {
      return { success: false, error: 'Query parameter is required' };
    }

    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      if (mcpStatus.error === 'unauthorized') {
        return { success: false, error: 'unauthorized', data: { message: mcpStatus.message } };
      }
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('search-tools', { queries: [query] });
      return { success: true, data: extractToolResult(result) };
    } catch (error) {
      if (error instanceof MCPUnauthorizedError) {
        return { success: false, error: 'unauthorized', data: { message: error.message } };
      }
      return { success: false, error: (error as Error).message };
    }
  });

  // ===== INTEGRATION ROUTES =====

  /**
   * List available integrations.
   * Fetches available IDs from MCP gateway, then enriches them with
   * static catalog details (title, description, actions) and filters by ?search=.
   */
  app.get('/agenco/integrations', async (request) => {
    const { search } = request.query as { search?: string };

    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      if (mcpStatus.error === 'unauthorized') {
        return { success: false, error: 'unauthorized', data: { message: mcpStatus.message } };
      }
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('list-available-integrations', {});
      const raw = extractToolResult(result) as { availableIntegrations?: string[] } | string[];
      const availableIds: string[] = Array.isArray(raw)
        ? raw
        : (raw as Record<string, unknown>).availableIntegrations as string[] ?? [];
      return { success: true, data: mapIntegrationsList(availableIds, search) };
    } catch (error) {
      if (error instanceof MCPUnauthorizedError) {
        return { success: false, error: 'unauthorized', data: { message: error.message } };
      }
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List connected integrations via MCP gateway
   */
  app.get('/agenco/integrations/connected', async () => {
    const mcpStatus = await ensureMCPActive(app);
    if (!mcpStatus.ok) {
      if (mcpStatus.error === 'unauthorized') {
        return { success: false, error: 'unauthorized', data: { message: mcpStatus.message } };
      }
      return { success: false, error: mcpStatus.message };
    }

    try {
      const client = getMCPClient()!;
      const result = await client.callTool('list-connected-integrations', {});
      const raw = extractToolResult(result);
      return { success: true, data: mapConnectedIntegrations(raw) };
    } catch (error) {
      if (error instanceof MCPUnauthorizedError) {
        return { success: false, error: 'unauthorized', data: { message: error.message } };
      }
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Get OAuth auth URL for an integration via marketplace REST API.
   * Uses stored JWT directly — no MCP connection needed.
   * If already connected, auto-provision matching built-in skills.
   */
  app.post('/agenco/integrations/connect', async (request) => {
    const { integration } = request.body as AgenCoConnectIntegrationRequest;

    // Get JWT from vault — no MCP client needed
    const vault = getVault();
    const agenco = await vault.get('agenco');

    if (!agenco?.accessToken) {
      return { success: false, error: 'unauthorized', data: { message: 'Not authenticated. Please log in via the Shield UI.' } };
    }

    if (agenco.expiresAt && agenco.expiresAt < Date.now()) {
      return { success: false, error: 'unauthorized', data: { message: 'Session expired. Please re-authenticate via the Shield UI.' } };
    }

    try {
      const response = await loggedFetch(
        `${MARKETPLACE_API}/api/integrations/connect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${agenco.accessToken}`,
          },
          body: JSON.stringify({ integrationId: integration }),
        },
        'agenco:integration-connect',
      );

      if (response.status === 401) {
        return { success: false, error: 'unauthorized', data: { message: 'Session expired or unauthorized. Please re-authenticate via the Shield UI.' } };
      }

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Marketplace API error (${response.status}): ${text}` };
      }

      const raw = await response.json();
      const parsed = mapConnectResponse(raw);

      if (parsed.status === 'already_connected' || parsed.status === 'connected') {
        addConnectedIntegration(integration);
        try {
          await app.skillManager.syncSource('mcp', 'openclaw');
        } catch (err) {
          console.error(`[AgenCo] Skill provisioning failed for ${integration}:`, (err as Error).message);
        }
        return { success: true, data: parsed };
      }

      return { success: true, data: parsed };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Disconnect an integration.
   * Removes integration from state and cleans up associated skills.
   */
  app.post('/agenco/integrations/disconnect', async (request) => {
    const { integration } = request.body as { integration: string };

    if (!integration) {
      return { success: false, error: 'Missing "integration" parameter' };
    }

    const state = loadState();
    if (!state.agenco.connectedIntegrations.includes(integration)) {
      return { success: false, error: `Integration "${integration}" is not connected` };
    }

    // Optionally call MCP disconnect-integration tool (non-fatal if unsupported)
    try {
      const mcpStatus = await ensureMCPActive(app);
      if (mcpStatus.ok) {
        const client = getMCPClient();
        if (client) {
          await client.callTool('disconnect-integration', { integrationId: integration });
        }
      }
    } catch {
      // Non-fatal — MCP tool may not exist
    }

    // Update state
    removeConnectedIntegration(integration);

    // Clean up skills via sync
    try {
      await app.skillManager.syncSource('mcp', 'openclaw');
    } catch (err) {
      console.error(`[AgenCo] Skill cleanup failed for ${integration}:`, (err as Error).message);
    }

    const updated = loadState();
    return {
      success: true,
      data: { connectedIntegrations: updated.agenco.connectedIntegrations },
    };
  });

  // ===== SKILL ROUTES =====

  /**
   * Get AgenCo skill installation status.
   * Checks if the master 'agenco' skill is installed and active via SkillManager.
   */
  app.get('/agenco/skills/status', async () => {
    const result = app.skillManager.getSkillBySlug('ag-agenco');
    const installed = result !== null
      && result.installations.some((i) => i.status === 'active');

    return {
      success: true,
      data: { installed, skillName: 'ag-agenco' },
    };
  });

  /**
   * Manually trigger AgenCo skill sync.
   * Installs missing skills, removes orphaned ones, and updates the master skill.
   * First refreshes local state from MCP to pick up externally-connected integrations.
   */
  app.post('/agenco/skills/sync', async () => {
    try {
      // Refresh local state from MCP before syncing — the source of truth
      // for connected integrations is the remote MCP server, not local state.
      const mcpStatus = await ensureMCPActive(app);
      if (mcpStatus.ok) {
        const client = getMCPClient();
        if (client) {
          try {
            const mcpResult = await client.callTool('list-connected-integrations', {});
            const raw = extractToolResult(mcpResult);
            const mapped = mapConnectedIntegrations(raw);
            const state = loadState();
            const remoteIds = mapped.integrations.map(i => i.id);
            const currentIds = state.agenco.connectedIntegrations;
            for (const id of remoteIds) {
              if (!currentIds.includes(id)) addConnectedIntegration(id);
            }
            for (const id of currentIds) {
              if (!remoteIds.includes(id)) removeConnectedIntegration(id);
            }
          } catch {
            // MCP call failed — proceed with existing local state
          }
        }
      }

      const result = await app.skillManager.syncSource('mcp', 'openclaw');
      if (result.errors.length > 0 && result.installed.length === 0 && result.updated.length === 0) {
        return { success: false, error: result.errors.join('; ') };
      }
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

}
