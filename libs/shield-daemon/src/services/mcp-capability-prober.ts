/**
 * MCP Capability Prober — on-demand probing of MCP server capabilities
 *
 * Connects to an MCP server via the appropriate transport, queries
 * listTools, listResources, listPrompts, then closes the connection.
 * Results are cached in-memory for 30 seconds per server ID.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServer, McpServerCapabilities } from '@agenshield/ipc';

const CACHE_TTL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;

interface CacheEntry {
  capabilities: McpServerCapabilities;
  expiresAt: number;
}

let instance: McpCapabilityProber | null = null;

export function initCapabilityProber(): McpCapabilityProber {
  instance = new McpCapabilityProber();
  return instance;
}

export function getCapabilityProber(): McpCapabilityProber {
  if (!instance) {
    throw new Error('McpCapabilityProber not initialized. Call initCapabilityProber() first.');
  }
  return instance;
}

export class McpCapabilityProber {
  private cache = new Map<string, CacheEntry>();

  /**
   * Probe an MCP server for its tools, resources, and prompts.
   * Returns cached result if still valid.
   */
  async probe(server: McpServer): Promise<McpServerCapabilities> {
    const cached = this.cache.get(server.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.capabilities;
    }

    const capabilities = await this.doProbe(server);
    this.cache.set(server.id, {
      capabilities,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return capabilities;
  }

  /**
   * Invalidate cached capabilities for a server.
   */
  invalidate(serverId: string): void {
    this.cache.delete(serverId);
  }

  private async doProbe(server: McpServer): Promise<McpServerCapabilities> {
    const probedAt = new Date().toISOString();

    try {
      const transport = this.createTransport(server);
      const client = new Client(
        { name: 'agenshield-prober', version: '0.1.0' },
        { capabilities: {} },
      );

      // Connect with timeout
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), CONNECT_TIMEOUT_MS);

      try {
        await Promise.race([
          client.connect(transport),
          new Promise<never>((_, reject) => {
            ac.signal.addEventListener('abort', () =>
              reject(new Error('Connection timeout')),
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }

      // Query capabilities in parallel
      const [toolsResult, resourcesResult, promptsResult] = await Promise.allSettled([
        client.listTools().catch(() => ({ tools: [] })),
        client.listResources().catch(() => ({ resources: [] })),
        client.listPrompts().catch(() => ({ prompts: [] })),
      ]);

      // Close connection
      try { await client.close(); } catch { /* ignore */ }

      const tools = toolsResult.status === 'fulfilled'
        ? (toolsResult.value.tools ?? []).map((t) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
            annotations: t.annotations as McpServerCapabilities['tools'][number]['annotations'],
          }))
        : [];

      const resources = resourcesResult.status === 'fulfilled'
        ? (resourcesResult.value.resources ?? []).map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          }))
        : [];

      const prompts = promptsResult.status === 'fulfilled'
        ? (promptsResult.value.prompts ?? []).map((p) => ({
            name: p.name,
            description: p.description,
            arguments: p.arguments?.map((a) => ({
              name: a.name,
              description: a.description,
              required: a.required,
            })),
          }))
        : [];

      return { tools, resources, prompts, probedAt };
    } catch (err) {
      return {
        tools: [],
        resources: [],
        prompts: [],
        probedAt,
        error: (err as Error).message,
      };
    }
  }

  private createTransport(server: McpServer) {
    const headers = { ...server.headers };

    // Add auth headers for supported auth types
    if (server.authType === 'bearer' && server.authConfig) {
      const token = (server.authConfig as { token?: string }).token;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } else if (server.authType === 'apikey' && server.authConfig) {
      const key = (server.authConfig as { key?: string }).key;
      const headerName = (server.authConfig as { headerName?: string }).headerName ?? 'X-API-Key';
      if (key) headers[headerName] = key;
    } else if (server.authType === 'oauth') {
      throw new Error('OAuth probing not supported');
    }

    switch (server.transport) {
      case 'stdio': {
        if (!server.command) throw new Error('stdio transport requires a command');
        return new StdioClientTransport({
          command: server.command,
          args: server.args,
          env: { ...process.env, ...server.env } as Record<string, string>,
        });
      }
      case 'sse': {
        if (!server.url) throw new Error('SSE transport requires a URL');
        return new SSEClientTransport(
          new URL(server.url),
          { requestInit: { headers } },
        );
      }
      case 'streamable-http': {
        if (!server.url) throw new Error('Streamable HTTP transport requires a URL');
        return new StreamableHTTPClientTransport(
          new URL(server.url),
          { requestInit: { headers } },
        );
      }
      default:
        throw new Error(`Unknown transport: ${server.transport}`);
    }
  }
}
