/**
 * MCP Client — thin wrapper around the official SDK
 *
 * Uses Client + StreamableHTTPClientTransport with VaultOAuthProvider
 * for automatic OAuth (DCR, PKCE, token exchange, refresh, 401 retry).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { VaultOAuthProvider } from './oauth-provider';

const TAG = '\x1b[36m[MCP]\x1b[0m';

export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

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
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private provider: VaultOAuthProvider;
  private gatewayUrl: string;
  private state: MCPConnectionState = 'disconnected';
  private active = false;

  /** Called when the connection state changes */
  onStateChange?: (state: MCPConnectionState) => void;

  constructor(gatewayUrl: string, daemonPort: number) {
    this.gatewayUrl = gatewayUrl;
    this.provider = new VaultOAuthProvider(daemonPort);
  }

  /**
   * Activate the MCP client.
   * Returns { authUrl } if the user needs to complete OAuth in a browser.
   */
  async activate(): Promise<{ authUrl?: string }> {
    if (this.active && this.state === 'connected') {
      return { authUrl: undefined };
    }
    this.active = true;

    this.transport = new StreamableHTTPClientTransport(
      new URL(this.gatewayUrl),
      { authProvider: this.provider },
    );

    this.client = new Client(
      { name: 'agenshield', version: '0.1.0' },
      { capabilities: {} },
    );

    this.setState('connecting');

    try {
      console.log(`${TAG} Connecting to ${this.gatewayUrl}…`);
      await this.client.connect(this.transport);
      console.log(`${TAG} Connected successfully`);
      this.setState('connected');
      return { authUrl: undefined };
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        // SDK called redirectToAuthorization — user must complete auth
        console.log(`${TAG} UnauthorizedError — auth URL: ${this.provider.capturedAuthUrl ? 'captured' : 'missing'}`);
        this.setState('disconnected');
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
   * The SDK exchanges the code for tokens, then we reconnect
   * with a fresh transport (the old one is already started).
   */
  async finishAuth(code: string): Promise<void> {
    if (!this.transport) {
      throw new Error('Client not initialized. Call activate() first.');
    }

    this.setState('connecting');

    try {
      console.log(`${TAG} Exchanging auth code for tokens…`);
      await this.transport.finishAuth(code);
      console.log(`${TAG} Token exchange complete — tokens saved to vault`);

      // Close old client/transport, create fresh ones to connect with tokens
      try { await this.client?.close(); } catch { /* ignore */ }

      this.transport = new StreamableHTTPClientTransport(
        new URL(this.gatewayUrl),
        { authProvider: this.provider },
      );
      this.client = new Client(
        { name: 'agenshield', version: '0.1.0' },
        { capabilities: {} },
      );

      console.log(`${TAG} Reconnecting with new tokens…`);
      await this.client.connect(this.transport);
      console.log(`${TAG} Connected after auth`);
      this.setState('connected');
    } catch (err) {
      console.error(`${TAG} finishAuth failed: ${(err as Error).message}`);
      this.setState('error');
      throw err;
    }
  }

  /** Disconnect from the MCP gateway */
  async deactivate(): Promise<void> {
    this.active = false;
    try {
      await this.client?.close();
    } catch {
      // ignore close errors
    }
    this.client = null;
    this.transport = null;
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

  /** List all available tools from the MCP gateway */
  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('Not connected');
    const result = await this.client.listTools();
    return (result.tools || []).map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  /** Call a tool on the MCP gateway */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.client) throw new Error('Not connected');
    const result = await this.client.callTool({ name, arguments: args });
    return result as unknown as MCPToolResult;
  }

  private setState(newState: MCPConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange?.(newState);
    }
  }
}
