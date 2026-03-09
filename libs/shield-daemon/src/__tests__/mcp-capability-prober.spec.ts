/**
 * McpCapabilityProber — unit tests
 *
 * Tests transport creation, auth header injection, caching,
 * timeout handling, partial failures, and singleton accessors.
 */

import type { McpServer, McpServerCapabilities } from '@agenshield/ipc';

// ── Mock SDK modules ────────────────────────────────────────────

// These must be accessed via the mock module references to survive jest.mock hoisting.
const sdkMocks = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  listTools: jest.fn().mockResolvedValue({ tools: [] }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: sdkMocks.connect,
    close: sdkMocks.close,
    listTools: sdkMocks.listTools,
    listResources: sdkMocks.listResources,
    listPrompts: sdkMocks.listPrompts,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

// ── Import after mocks ─────────────────────────────────────────

import { McpCapabilityProber } from '../services/mcp-capability-prober';
import { StdioClientTransport as MockStdioTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport as MockSSETransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport as MockStreamableHTTPTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Shorthand aliases for SDK mocks
const mockConnect = sdkMocks.connect;
const mockClose = sdkMocks.close;
const mockListTools = sdkMocks.listTools;
const mockListResources = sdkMocks.listResources;
const mockListPrompts = sdkMocks.listPrompts;

// ── Factory helper ──────────────────────────────────────────────

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 'srv-1',
    name: 'Test Server',
    slug: 'test-server',
    description: 'A test MCP server',
    transport: 'stdio',
    url: null,
    command: '/usr/bin/test-mcp',
    args: ['--serve'],
    env: {},
    headers: {},
    authType: 'none',
    authConfig: null,
    source: 'manual',
    managed: false,
    managedSource: null,
    status: 'active',
    profileId: null,
    configJson: null,
    supportedTargets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('McpCapabilityProber', () => {
  let prober: McpCapabilityProber;

  beforeEach(() => {
    prober = new McpCapabilityProber();
    jest.clearAllMocks();

    // Reset defaults
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [] });
    mockListResources.mockResolvedValue({ resources: [] });
    mockListPrompts.mockResolvedValue({ prompts: [] });
  });

  // ─── Successful probing ───────────────────────────────────

  describe('probe — successful', () => {
    it('returns mapped tools, resources, prompts from SDK', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
        ],
      });
      mockListResources.mockResolvedValue({
        resources: [
          { uri: 'file:///tmp/a.txt', name: 'a.txt', description: 'A file', mimeType: 'text/plain' },
        ],
      });
      mockListPrompts.mockResolvedValue({
        prompts: [
          { name: 'summarize', description: 'Summarize text', arguments: [{ name: 'text', description: 'Input', required: true }] },
        ],
      });

      const result = await prober.probe(makeServer());

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toEqual({
        name: 'read_file',
        description: 'Read a file',
        inputSchema: { type: 'object' },
        annotations: undefined,
      });
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toEqual({
        uri: 'file:///tmp/a.txt',
        name: 'a.txt',
        description: 'A file',
        mimeType: 'text/plain',
      });
      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0]).toEqual({
        name: 'summarize',
        description: 'Summarize text',
        arguments: [{ name: 'text', description: 'Input', required: true }],
      });
    });

    it('maps tool annotations correctly', async () => {
      mockListTools.mockResolvedValue({
        tools: [{
          name: 'delete_file',
          description: 'Delete',
          inputSchema: {},
          annotations: { title: 'Delete File', destructiveHint: true, readOnlyHint: false },
        }],
      });

      const result = await prober.probe(makeServer());

      expect(result.tools[0].annotations).toEqual({
        title: 'Delete File',
        destructiveHint: true,
        readOnlyHint: false,
      });
    });

    it('maps prompt arguments correctly', async () => {
      mockListPrompts.mockResolvedValue({
        prompts: [{
          name: 'translate',
          description: 'Translate text',
          arguments: [
            { name: 'text', description: 'Source text', required: true },
            { name: 'lang', description: 'Target language', required: false },
          ],
        }],
      });

      const result = await prober.probe(makeServer());

      expect(result.prompts[0].arguments).toEqual([
        { name: 'text', description: 'Source text', required: true },
        { name: 'lang', description: 'Target language', required: false },
      ]);
    });

    it('includes probedAt as ISO string', async () => {
      const result = await prober.probe(makeServer());

      expect(result.probedAt).toBeDefined();
      expect(new Date(result.probedAt).toISOString()).toBe(result.probedAt);
    });

    it('handles empty capability arrays', async () => {
      const result = await prober.probe(makeServer());

      expect(result.tools).toEqual([]);
      expect(result.resources).toEqual([]);
      expect(result.prompts).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it('defaults description to empty string when missing from tool', async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: 'no_desc', inputSchema: {} }],
      });

      const result = await prober.probe(makeServer());

      expect(result.tools[0].description).toBe('');
    });
  });

  // ─── Transport creation ───────────────────────────────────

  describe('probe — transport creation', () => {
    it('creates StdioClientTransport with command, args, env', async () => {
      const server = makeServer({
        transport: 'stdio',
        command: '/usr/bin/my-mcp',
        args: ['--port', '8080'],
        env: { FOO: 'bar' },
      });

      await prober.probe(server);

      expect(MockStdioTransport).toHaveBeenCalledWith({
        command: '/usr/bin/my-mcp',
        args: ['--port', '8080'],
        env: expect.objectContaining({ FOO: 'bar' }),
      });
    });

    it('creates SSEClientTransport with URL for sse', async () => {
      const server = makeServer({
        transport: 'sse',
        url: 'https://example.com/sse',
        command: null,
      });

      await prober.probe(server);

      expect(MockSSETransport).toHaveBeenCalledWith(
        new URL('https://example.com/sse'),
        { requestInit: { headers: {} } },
      );
    });

    it('creates StreamableHTTPClientTransport for streamable-http', async () => {
      const server = makeServer({
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        command: null,
      });

      await prober.probe(server);

      expect(MockStreamableHTTPTransport).toHaveBeenCalledWith(
        new URL('https://example.com/mcp'),
        { requestInit: { headers: {} } },
      );
    });

    it('error result for stdio without command', async () => {
      const server = makeServer({ transport: 'stdio', command: null });

      const result = await prober.probe(server);

      expect(result.error).toBe('stdio transport requires a command');
      expect(result.tools).toEqual([]);
    });

    it('error result for SSE without url', async () => {
      const server = makeServer({ transport: 'sse', url: null, command: null });

      const result = await prober.probe(server);

      expect(result.error).toBe('SSE transport requires a URL');
      expect(result.tools).toEqual([]);
    });

    it('error result for streamable-http without url', async () => {
      const server = makeServer({ transport: 'streamable-http', url: null, command: null });

      const result = await prober.probe(server);

      expect(result.error).toBe('Streamable HTTP transport requires a URL');
      expect(result.tools).toEqual([]);
    });
  });

  // ─── Auth headers ─────────────────────────────────────────

  describe('probe — auth headers', () => {
    it('injects Authorization header for bearer auth', async () => {
      const server = makeServer({
        transport: 'sse',
        url: 'https://example.com/sse',
        command: null,
        authType: 'bearer',
        authConfig: { token: 'my-secret-token' },
      });

      await prober.probe(server);

      expect(MockSSETransport).toHaveBeenCalledWith(
        expect.any(URL),
        { requestInit: { headers: { Authorization: 'Bearer my-secret-token' } } },
      );
    });

    it('injects X-API-Key header for apikey (default headerName)', async () => {
      const server = makeServer({
        transport: 'sse',
        url: 'https://example.com/sse',
        command: null,
        authType: 'apikey',
        authConfig: { key: 'ak-12345' },
      });

      await prober.probe(server);

      expect(MockSSETransport).toHaveBeenCalledWith(
        expect.any(URL),
        { requestInit: { headers: { 'X-API-Key': 'ak-12345' } } },
      );
    });

    it('injects custom headerName for apikey', async () => {
      const server = makeServer({
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        command: null,
        authType: 'apikey',
        authConfig: { key: 'custom-key', headerName: 'X-Custom-Auth' },
      });

      await prober.probe(server);

      expect(MockStreamableHTTPTransport).toHaveBeenCalledWith(
        expect.any(URL),
        { requestInit: { headers: { 'X-Custom-Auth': 'custom-key' } } },
      );
    });

    it('merges auth headers with existing server.headers', async () => {
      const server = makeServer({
        transport: 'sse',
        url: 'https://example.com/sse',
        command: null,
        headers: { 'X-Existing': 'value' },
        authType: 'bearer',
        authConfig: { token: 'tok' },
      });

      await prober.probe(server);

      expect(MockSSETransport).toHaveBeenCalledWith(
        expect.any(URL),
        {
          requestInit: {
            headers: {
              'X-Existing': 'value',
              Authorization: 'Bearer tok',
            },
          },
        },
      );
    });

    it('error result for OAuth auth type', async () => {
      const server = makeServer({
        transport: 'sse',
        url: 'https://example.com/sse',
        command: null,
        authType: 'oauth',
        authConfig: {},
      });

      const result = await prober.probe(server);

      expect(result.error).toBe('OAuth probing not supported');
      expect(result.tools).toEqual([]);
    });
  });

  // ─── Caching ──────────────────────────────────────────────

  describe('probe — caching', () => {
    it('returns cached result on second call (same reference, no reconnect)', async () => {
      const server = makeServer();

      const first = await prober.probe(server);
      const second = await prober.probe(server);

      expect(first).toBe(second);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('re-probes after TTL expires', async () => {
      const now = Date.now();
      const dateSpy = jest.spyOn(Date, 'now');

      // First call at t=0
      dateSpy.mockReturnValue(now);
      const first = await prober.probe(makeServer());
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Second call at t=31s (past 30s TTL)
      dateSpy.mockReturnValue(now + 31_000);
      const second = await prober.probe(makeServer());
      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(second).not.toBe(first);

      dateSpy.mockRestore();
    });

    it('caches per server ID independently', async () => {
      const srv1 = makeServer({ id: 'srv-a' });
      const srv2 = makeServer({ id: 'srv-b' });

      await prober.probe(srv1);
      await prober.probe(srv2);

      expect(mockConnect).toHaveBeenCalledTimes(2);

      // Both cached
      await prober.probe(srv1);
      await prober.probe(srv2);

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Invalidate ───────────────────────────────────────────

  describe('invalidate', () => {
    it('clears cache, next probe reconnects', async () => {
      const server = makeServer();
      await prober.probe(server);
      expect(mockConnect).toHaveBeenCalledTimes(1);

      prober.invalidate(server.id);
      await prober.probe(server);
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('does not affect other server IDs', async () => {
      const srv1 = makeServer({ id: 'srv-x' });
      const srv2 = makeServer({ id: 'srv-y' });

      await prober.probe(srv1);
      await prober.probe(srv2);
      expect(mockConnect).toHaveBeenCalledTimes(2);

      prober.invalidate('srv-x');
      await prober.probe(srv1);
      await prober.probe(srv2); // still cached

      expect(mockConnect).toHaveBeenCalledTimes(3);
    });

    it('no-op for non-existent ID', () => {
      // Should not throw
      expect(() => prober.invalidate('non-existent')).not.toThrow();
    });
  });

  // ─── Error handling ───────────────────────────────────────

  describe('probe — error handling', () => {
    it('error result when client.connect() rejects', async () => {
      mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await prober.probe(makeServer());

      expect(result.error).toBe('ECONNREFUSED');
      expect(result.tools).toEqual([]);
      expect(result.resources).toEqual([]);
      expect(result.prompts).toEqual([]);
    });

    it('error result on connection timeout', async () => {
      jest.useFakeTimers();

      // connect() never resolves
      mockConnect.mockImplementation(() => new Promise<void>(() => { /* never resolves */ }));

      const probePromise = prober.probe(makeServer());

      // Advance past the 15s timeout
      jest.advanceTimersByTime(15_000);

      const result = await probePromise;

      expect(result.error).toBe('Connection timeout');
      expect(result.tools).toEqual([]);

      jest.useRealTimers();
    });

    it('empty arrays + error message on failure', async () => {
      mockConnect.mockRejectedValue(new Error('something broke'));

      const result = await prober.probe(makeServer());

      expect(result.tools).toEqual([]);
      expect(result.resources).toEqual([]);
      expect(result.prompts).toEqual([]);
      expect(result.error).toBe('something broke');
    });

    it('probedAt present in error results', async () => {
      mockConnect.mockRejectedValue(new Error('fail'));

      const result = await prober.probe(makeServer());

      expect(result.probedAt).toBeDefined();
      expect(new Date(result.probedAt).toISOString()).toBe(result.probedAt);
    });

    it('partial failures: listTools fails but resources/prompts still returned', async () => {
      mockListTools.mockRejectedValue(new Error('tools unsupported'));
      mockListResources.mockResolvedValue({
        resources: [{ uri: 'file:///a', name: 'a' }],
      });
      mockListPrompts.mockResolvedValue({
        prompts: [{ name: 'p1', description: 'prompt 1' }],
      });

      const result = await prober.probe(makeServer());

      // tools falls back to empty via .catch()
      expect(result.tools).toEqual([]);
      // resources and prompts still populated
      expect(result.resources).toHaveLength(1);
      expect(result.prompts).toHaveLength(1);
      expect(result.error).toBeUndefined();
    });

    it('calls client.close() even on partial failure', async () => {
      mockListTools.mockRejectedValue(new Error('tools unsupported'));

      await prober.probe(makeServer());

      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ─── Singleton accessors ──────────────────────────────────

  describe('singleton accessors', () => {
    it('getCapabilityProber() throws before init', async () => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getCapabilityProber } = require('../services/mcp-capability-prober');
        expect(() => getCapabilityProber()).toThrow('McpCapabilityProber not initialized');
      });
    });

    it('initCapabilityProber() creates instance, getCapabilityProber() returns it', async () => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initCapabilityProber, getCapabilityProber } = require('../services/mcp-capability-prober');
        const instance = initCapabilityProber();
        expect(getCapabilityProber()).toBe(instance);
      });
    });
  });
});
