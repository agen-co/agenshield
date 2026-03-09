/**
 * GET /mcps/:id/capabilities — route unit tests
 *
 * Tests the capabilities endpoint handler directly via a mock
 * Fastify instance that captures registered route handlers.
 */

import type { McpServer, McpServerCapabilities } from '@agenshield/ipc';

// ── Mocks ───────────────────────────────────────────────────────

const mockGetById = jest.fn();
const mockGetAll = jest.fn().mockReturnValue([]);

jest.mock('@agenshield/storage', () => ({
  getStorage: jest.fn(() => ({
    mcpServers: {
      getById: (...args: unknown[]) => mockGetById(...args),
      getAll: (...args: unknown[]) => mockGetAll(...args),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  })),
}));

jest.mock('../services/mcp-manager', () => ({
  hasMcpManager: jest.fn(() => false),
  getMcpManager: jest.fn(),
}));

const mockProbe = jest.fn();
const mockInvalidate = jest.fn();

jest.mock('../services/mcp-capability-prober', () => ({
  getCapabilityProber: jest.fn(() => ({
    probe: (...args: unknown[]) => mockProbe(...args),
    invalidate: (...args: unknown[]) => mockInvalidate(...args),
  })),
}));

// ── Import route after mocks ────────────────────────────────────

import { mcpsRoutes } from '../routes/mcps';

// ── Factory helpers ─────────────────────────────────────────────

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 'srv-1',
    name: 'Test Server',
    slug: 'test-server',
    description: 'A test MCP server',
    transport: 'stdio',
    url: null,
    command: '/usr/bin/test-mcp',
    args: [],
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

function makeCapabilities(overrides: Partial<McpServerCapabilities> = {}): McpServerCapabilities {
  return {
    tools: [],
    resources: [],
    prompts: [],
    probedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Mock Fastify instance to capture route handlers ─────────────

type RouteHandler = (request: unknown, reply: unknown) => Promise<unknown>;

const routeHandlers: Record<string, RouteHandler> = {};

function createMockApp() {
  return {
    get: jest.fn((path: string, handler: RouteHandler) => {
      routeHandlers[`GET ${path}`] = handler;
    }),
    post: jest.fn((path: string, handler: RouteHandler) => {
      routeHandlers[`POST ${path}`] = handler;
    }),
    patch: jest.fn((path: string, handler: RouteHandler) => {
      routeHandlers[`PATCH ${path}`] = handler;
    }),
    delete: jest.fn((path: string, handler: RouteHandler) => {
      routeHandlers[`DELETE ${path}`] = handler;
    }),
  };
}

function createMockReply() {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(body: unknown) {
      reply.body = body;
      return body;
    },
  };
  return reply;
}

// ── Tests ───────────────────────────────────────────────────────

describe('GET /mcps/:id/capabilities', () => {
  let handler: RouteHandler;

  beforeAll(async () => {
    const app = createMockApp();
    await mcpsRoutes(app as never);
    handler = routeHandlers['GET /mcps/:id/capabilities'];
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handler is registered', () => {
    expect(handler).toBeDefined();
  });

  it('404 when server not found', async () => {
    mockGetById.mockReturnValue(null);
    const reply = createMockReply();

    const result = await handler(
      { params: { id: 'non-existent' }, query: {} },
      reply,
    );

    expect(reply.statusCode).toBe(404);
    expect(result).toEqual({
      success: false,
      error: { message: 'Not found' },
    });
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it('400 when server status is disabled', async () => {
    mockGetById.mockReturnValue(makeServer({ status: 'disabled' }));
    const reply = createMockReply();

    const result = await handler(
      { params: { id: 'srv-1' }, query: {} },
      reply,
    );

    expect(reply.statusCode).toBe(400);
    expect((result as { error: { message: string } }).error.message).toContain('disabled');
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it('400 when server status is blocked', async () => {
    mockGetById.mockReturnValue(makeServer({ status: 'blocked' }));
    const reply = createMockReply();

    const result = await handler(
      { params: { id: 'srv-1' }, query: {} },
      reply,
    );

    expect(reply.statusCode).toBe(400);
    expect((result as { error: { message: string } }).error.message).toContain('blocked');
  });

  it('200 with capabilities for active server', async () => {
    const server = makeServer({ status: 'active' });
    const caps = makeCapabilities({
      tools: [{ name: 'read_file', description: 'Read', inputSchema: {} }],
    });

    mockGetById.mockReturnValue(server);
    mockProbe.mockResolvedValue(caps);
    const reply = createMockReply();

    const result = await handler(
      { params: { id: 'srv-1' }, query: {} },
      reply,
    );

    expect(result).toEqual({ success: true, data: caps });
    const data = (result as { data: McpServerCapabilities }).data;
    expect(data.tools).toHaveLength(1);
    expect(data.tools[0].name).toBe('read_file');
  });

  it('200 for pending status server (not blocked)', async () => {
    const server = makeServer({ status: 'pending' });
    const caps = makeCapabilities();

    mockGetById.mockReturnValue(server);
    mockProbe.mockResolvedValue(caps);
    const reply = createMockReply();

    const result = await handler(
      { params: { id: 'srv-1' }, query: {} },
      reply,
    );

    expect(result).toEqual({ success: true, data: caps });
  });

  it('invalidates cache when ?refresh=true', async () => {
    const server = makeServer();
    mockGetById.mockReturnValue(server);
    mockProbe.mockResolvedValue(makeCapabilities());
    const reply = createMockReply();

    await handler(
      { params: { id: 'srv-1' }, query: { refresh: 'true' } },
      reply,
    );

    expect(mockInvalidate).toHaveBeenCalledWith('srv-1');
    expect(mockProbe).toHaveBeenCalledWith(server);
  });

  it('does NOT invalidate when refresh param absent', async () => {
    mockGetById.mockReturnValue(makeServer());
    mockProbe.mockResolvedValue(makeCapabilities());
    const reply = createMockReply();

    await handler(
      { params: { id: 'srv-1' }, query: {} },
      reply,
    );

    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(mockProbe).toHaveBeenCalled();
  });

  it('returns { success: true, data: capabilities } structure', async () => {
    const caps = makeCapabilities({
      tools: [{ name: 't1', description: 'd1', inputSchema: {} }],
      resources: [{ uri: 'r1', name: 'r1' }],
      prompts: [{ name: 'p1' }],
    });
    mockGetById.mockReturnValue(makeServer());
    mockProbe.mockResolvedValue(caps);
    const reply = createMockReply();

    const result = await handler(
      { params: { id: 'srv-1' }, query: {} },
      reply,
    );

    const body = result as { success: boolean; data: McpServerCapabilities };
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('data');
    expect(body.data).toHaveProperty('tools');
    expect(body.data).toHaveProperty('resources');
    expect(body.data).toHaveProperty('prompts');
    expect(body.data).toHaveProperty('probedAt');
  });

  it('returns success: true even when probe returns error in data', async () => {
    const caps = makeCapabilities({
      error: 'Connection refused',
      tools: [],
      resources: [],
      prompts: [],
    });
    mockGetById.mockReturnValue(makeServer());
    mockProbe.mockResolvedValue(caps);
    const reply = createMockReply();

    const result = await handler(
      { params: { id: 'srv-1' }, query: {} },
      reply,
    );

    const body = result as { success: boolean; data: McpServerCapabilities };
    expect(body.success).toBe(true);
    expect(body.data.error).toBe('Connection refused');
  });
});
