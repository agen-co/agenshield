/**
 * MCP Client — thin wrapper around the official SDK
 *
 * Uses Client + StreamableHTTPClientTransport with VaultOAuthProvider
 * for automatic OAuth (DCR, PKCE, token exchange, refresh, 401 retry).
 *
 * On-demand connection model: each operation opens a fresh connection,
 * executes, and closes immediately. No persistent connection is maintained.
 * State `connected` means "authenticated and ready for on-demand calls".
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { VaultOAuthProvider } from './oauth-provider';

const TAG = '\x1b[36m[MCP]\x1b[0m';

export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'unauthorized';

/**
 * Typed error thrown when the MCP connection is unauthorized.
 * Routes catch this to return structured `{ error: 'unauthorized' }` responses.
 */
export class MCPUnauthorizedError extends Error {
  constructor(message = 'Session expired or unauthorized. Please re-authenticate via the Shield UI.') {
    super(message);
    this.name = 'MCPUnauthorizedError';
  }
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  integration?: string;
}

export interface MCPToolResult {
  content: Array<{ type: string; text?: string; data?: unknown }>;
  isError?: boolean;
}

export class MCPClient {
  private provider: VaultOAuthProvider;
  private gatewayUrl: string;
  private state: MCPConnectionState = 'disconnected';
  private active = false;

  /** Transport kept only during the OAuth flow (activate → finishAuth) */
  private authTransport: StreamableHTTPClientTransport | null = null;

  /** Called when the connection state changes */
  onStateChange?: (state: MCPConnectionState) => void;

  constructor(gatewayUrl: string, daemonPort: number) {
    this.gatewayUrl = gatewayUrl;
    this.provider = new VaultOAuthProvider(daemonPort);
  }

  /**
   * Activate the MCP client.
   * Tries a probe connection to verify stored tokens are valid.
   * Returns { authUrl } if the user needs to complete OAuth in a browser.
   */
  async activate(): Promise<{ authUrl?: string }> {
    if (this.active && this.state === 'connected') {
      return { authUrl: undefined };
    }
    this.active = true;
    this.setState('connecting');

    const transport = new StreamableHTTPClientTransport(
      new URL(this.gatewayUrl),
      { authProvider: this.provider },
    );

    const client = new Client(
      { name: 'agenshield', version: '0.1.0' },
      { capabilities: {} },
    );

    try {
      console.log(`${TAG} Verifying tokens against ${this.gatewayUrl}…`);
      await client.connect(transport);
      // Tokens are valid — close the probe connection immediately
      try { await client.close(); } catch { /* ignore */ }
      console.log(`${TAG} Tokens valid — ready for on-demand connections`);
      this.setState('connected');
      return { authUrl: undefined };
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        // SDK triggered OAuth redirect — keep the transport for finishAuth()
        this.authTransport = transport;
        console.log(`${TAG} UnauthorizedError — auth URL: ${this.provider.capturedAuthUrl ? 'captured' : 'missing'}`);
        this.setState('unauthorized');
        return { authUrl: this.provider.capturedAuthUrl ?? undefined };
      }
      const cause = (err as Error & { cause?: Error }).cause;
      console.error(`${TAG} Connection error: ${(err as Error).message}${cause ? ` — cause: ${cause.message}` : ''}`);
      this.setState('error');
      throw err;
    }
  }

  /**
   * Complete OAuth after receiving the authorization code.
   * The SDK exchanges the code for tokens, then we verify with a probe connection.
   */
  async finishAuth(code: string): Promise<void> {
    if (!this.authTransport) {
      throw new Error('Client not initialized. Call activate() first.');
    }

    this.setState('connecting');

    try {
      console.log(`${TAG} Exchanging auth code for tokens…`);
      await this.authTransport.finishAuth(code);
      console.log(`${TAG} Token exchange complete — tokens saved to vault`);
      this.authTransport = null;

      // Verify with a fresh probe connection
      const transport = new StreamableHTTPClientTransport(
        new URL(this.gatewayUrl),
        { authProvider: this.provider },
      );
      const client = new Client(
        { name: 'agenshield', version: '0.1.0' },
        { capabilities: {} },
      );

      console.log(`${TAG} Verifying new tokens…`);
      await client.connect(transport);
      try { await client.close(); } catch { /* ignore */ }
      console.log(`${TAG} Authenticated — ready for on-demand connections`);
      this.setState('connected');
    } catch (err) {
      console.error(`${TAG} finishAuth failed: ${(err as Error).message}`);
      this.setState('error');
      throw err;
    }
  }

  /** Mark the client as deactivated */
  async deactivate(): Promise<void> {
    this.active = false;
    this.authTransport = null;
    this.setState('disconnected');
  }

  /** Whether the client has been activated */
  isActive(): boolean {
    return this.active;
  }

  /** Current connection state */
  getState(): MCPConnectionState {
    return this.state;
  }

  /** List all available tools from the MCP gateway (on-demand connection) */
  async listTools(): Promise<MCPTool[]> {
    return this.withConnection(async (client) => {
      const result = await client.listTools();
      return (result.tools || []).map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
    });
  }

  /** Call a tool on the MCP gateway (on-demand connection) */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    return this.withConnection(async (client) => {
      const result = await client.callTool({ name, arguments: args });
      return result as unknown as MCPToolResult;
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Open a temporary connection, run `fn`, then close.
   * Handles UnauthorizedError → sets state and throws MCPUnauthorizedError.
   */
  private async withConnection<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    if (this.state === 'unauthorized') throw new MCPUnauthorizedError();

    const transport = new StreamableHTTPClientTransport(
      new URL(this.gatewayUrl),
      { authProvider: this.provider },
    );
    const client = new Client(
      { name: 'agenshield', version: '0.1.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
      const result = await fn(client);
      return result;
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.setState('unauthorized');
        throw new MCPUnauthorizedError();
      }
      throw err;
    } finally {
      try { await client.close(); } catch { /* ignore */ }
    }
  }

  private setState(newState: MCPConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange?.(newState);
    }
  }
}
