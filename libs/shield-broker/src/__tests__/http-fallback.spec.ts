import * as http from 'node:http';
import * as net from 'node:net';
import * as dns from 'node:dns';
import { Resolver } from 'node:dns/promises';
import { HttpFallbackServer } from '../http-fallback.js';

// Mock dns modules for resolveHostname tests
jest.mock('node:dns', () => {
  const actual = jest.requireActual('node:dns');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      lookup: jest.fn(),
    },
  };
});

jest.mock('node:dns/promises', () => ({
  Resolver: jest.fn().mockImplementation(() => ({
    setServers: jest.fn(),
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  })),
}));

// Mock daemon-forward module
jest.mock('../daemon-forward.js', () => ({
  forwardPolicyToDaemon: jest.fn().mockResolvedValue(null),
  forwardEventsToDaemon: jest.fn(),
}));

// Mock handlers module so processRequest doesn't need real handler implementations
jest.mock('../handlers/index.js', () => ({
  handlePing: jest.fn().mockResolvedValue({
    success: true,
    data: { pong: true, timestamp: new Date().toISOString(), version: '0.1.0' },
  }),
  handleHttpRequest: jest.fn().mockResolvedValue({ success: true, data: {} }),
  handleFileRead: jest.fn().mockResolvedValue({ success: true, data: {} }),
  handleFileList: jest.fn().mockResolvedValue({ success: true, data: {} }),
  handleOpenUrl: jest.fn().mockResolvedValue({ success: true, data: {} }),
  handlePolicyCheck: jest.fn().mockResolvedValue({ success: true, data: { allowed: true } }),
  handleEventsBatch: jest.fn().mockResolvedValue({ success: true, data: {} }),
}));

// Mock @agenshield/proxy for classifyNetworkError
jest.mock('@agenshield/proxy', () => ({
  classifyNetworkError: jest.fn().mockImplementation((err: Error & { code?: string }) => {
    const code = err.code ?? '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return { type: 'dns-resolution-failed', userMessage: `DNS resolution failed: ${err.message}` };
    }
    if (code === 'ECONNREFUSED') {
      return { type: 'connection-refused', userMessage: `Connection refused: ${err.message}` };
    }
    return { type: 'network-error', userMessage: `Network error: ${err.message}` };
  }),
}));

import { forwardPolicyToDaemon } from '../daemon-forward.js';
import * as handlersMod from '../handlers/index.js';

const mockForwardPolicyToDaemon = forwardPolicyToDaemon as jest.MockedFunction<
  typeof forwardPolicyToDaemon
>;

const mockDnsLookup = dns.promises.lookup as jest.MockedFunction<typeof dns.promises.lookup>;

interface MockDeps {
  policyEnforcer: { check: jest.Mock };
  auditLogger: { log: jest.Mock };
  commandAllowlist: Record<string, unknown>;
}

function createMocks(): MockDeps {
  return {
    policyEnforcer: {
      check: jest.fn().mockResolvedValue({ allowed: true }),
    },
    auditLogger: {
      log: jest.fn().mockResolvedValue(undefined),
    },
    commandAllowlist: {},
  };
}

function createConfig(overrides?: Partial<Record<string, unknown>>) {
  return {
    socketPath: '/tmp/test-broker.sock',
    httpEnabled: true,
    httpPort: 0, // ephemeral
    httpHost: '127.0.0.1',
    configPath: '/tmp/test-config',
    policiesPath: '/tmp/test-policies',
    auditLogPath: '/tmp/test-audit.log',
    logLevel: 'error' as const,
    failOpen: false,
    socketMode: 0o660,
    daemonUrl: 'http://127.0.0.1:5200',
    ...overrides,
  };
}

async function startServer(mockOverrides?: Partial<MockDeps>) {
  const mocks = createMocks();
  if (mockOverrides?.policyEnforcer) {
    Object.assign(mocks.policyEnforcer, mockOverrides.policyEnforcer);
  }
  if (mockOverrides?.auditLogger) {
    Object.assign(mocks.auditLogger, mockOverrides.auditLogger);
  }

  const config = createConfig();
  const server = new HttpFallbackServer({
    config: config as any,
    policyEnforcer: mocks.policyEnforcer as any,
    auditLogger: mocks.auditLogger as any,
    commandAllowlist: mocks.commandAllowlist as any,
  });

  await server.start();

  // Extract the actual port assigned by the OS
  const address = (server as any).server.address();
  const port = typeof address === 'object' ? address.port : 0;

  return { server, port, mocks };
}

/**
 * Create a simple TCP echo server for tunnel testing.
 * Returns the server and its ephemeral port.
 */
function createEchoServer(): Promise<{ echoServer: net.Server; echoPort: number }> {
  return new Promise((resolve) => {
    const echoServer = net.createServer((socket) => {
      socket.pipe(socket);
    });
    echoServer.listen(0, '127.0.0.1', () => {
      const addr = echoServer.address() as net.AddressInfo;
      resolve({ echoServer, echoPort: addr.port });
    });
  });
}

/**
 * Create a simple HTTP server that returns a known response body.
 */
function createTargetHttpServer(
  responseBody: string
): Promise<{ targetServer: http.Server; targetPort: number }> {
  return new Promise((resolve) => {
    const targetServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(responseBody);
    });
    targetServer.listen(0, '127.0.0.1', () => {
      const addr = targetServer.address() as net.AddressInfo;
      resolve({ targetServer, targetPort: addr.port });
    });
  });
}

/** Helper to make a JSON-RPC POST to /rpc */
function rpcRequest(
  port: number,
  payload: Record<string, unknown>
): Promise<{ statusCode: number; json: any }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/rpc',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode!,
            json: JSON.parse(data),
          });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Find an ephemeral port that is NOT listening.
 * Opens a server, records the port, then closes it.
 */
function findClosedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      const p = addr.port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(p);
      });
    });
  });
}

/** Set up DNS mocks so system resolver works for IP / localhost */
function setupDefaultDnsMocks() {
  mockDnsLookup.mockImplementation(async (hostname: string) => {
    if (net.isIP(hostname as string)) {
      return { address: hostname as string, family: 4 } as any;
    }
    if (hostname === 'localhost') {
      return { address: '127.0.0.1', family: 4 } as any;
    }
    throw new Error(`Mock DNS: cannot resolve ${hostname}`);
  });
}

describe('HttpFallbackServer', () => {
  let server: HttpFallbackServer;
  let port: number;
  let mocks: MockDeps;

  beforeEach(() => {
    setupDefaultDnsMocks();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    jest.clearAllMocks();
  });

  // ─── CONNECT tunnel — allowed ───────────────────────────────────────

  describe('CONNECT tunnel — allowed', () => {
    it('should return 200 Connection Established when policy allows', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      try {
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });
          req.on('connect', (_res, _socket, _head) => {
            _socket.destroy();
            resolve(_res);
          });
          req.on('error', reject);
          req.end();
        });

        expect(response.statusCode).toBe(200);
        expect(response.statusMessage).toBe('Connection Established');
        expect(mocks.policyEnforcer.check).toHaveBeenCalledWith(
          'http_request',
          { url: 'https://127.0.0.1' },
          expect.objectContaining({ channel: 'http' })
        );
        expect(mocks.auditLogger.log).toHaveBeenCalledWith(
          expect.objectContaining({
            allowed: true,
            metadata: expect.objectContaining({ protocol: 'https', method: 'CONNECT' }),
          })
        );
      } finally {
        echoServer.close();
      }
    });

    it('should pipe data bidirectionally through the tunnel', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      try {
        const echoed = await new Promise<string>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });

          req.on('connect', (_res, socket) => {
            if (_res.statusCode !== 200) {
              socket.destroy();
              reject(new Error(`CONNECT failed: ${_res.statusCode}`));
              return;
            }
            const testPayload = 'hello-tunnel';
            socket.write(testPayload);

            let data = '';
            socket.on('data', (chunk) => {
              data += chunk.toString();
              if (data.length >= testPayload.length) {
                socket.destroy();
                resolve(data);
              }
            });
            socket.on('error', reject);
          });
          req.on('error', reject);
          req.end();
        });

        expect(echoed).toBe('hello-tunnel');
      } finally {
        echoServer.close();
      }
    });
  });

  // ─── CONNECT tunnel — denied by policy ──────────────────────────────

  describe('CONNECT tunnel — denied by policy', () => {
    it('should return 403 Forbidden when policy denies', async () => {
      ({ server, port, mocks } = await startServer());
      mocks.policyEnforcer.check.mockResolvedValue({
        allowed: false,
        reason: 'blocked',
      });

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: 'evil.com:443',
        });
        req.on('connect', (res, socket) => {
          socket.destroy();
          resolve(res);
        });
        req.on('error', reject);
        req.end();
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          allowed: false,
          result: 'denied',
          target: 'evil.com:443',
        })
      );
    });
  });

  // ─── CONNECT tunnel — denied then allowed by daemon forward ─────────

  describe('CONNECT tunnel — denied then allowed by daemon forward', () => {
    it('should return 200 when daemon override allows', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      try {
        mocks.policyEnforcer.check.mockResolvedValue({
          allowed: false,
          reason: 'no matching policy',
        });
        mockForwardPolicyToDaemon.mockResolvedValueOnce({
          allowed: true,
          policyId: 'daemon-policy',
        });

        // Use 127.0.0.1 (IP, skips DNS resolution) to avoid DNS mock issues
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });
          req.on('connect', (res, socket) => {
            socket.destroy();
            resolve(res);
          });
          req.on('error', reject);
          req.end();
        });

        expect(response.statusCode).toBe(200);
        expect(mockForwardPolicyToDaemon).toHaveBeenCalledWith(
          'http_request',
          'https://127.0.0.1',
          expect.any(String),
          undefined,
          undefined
        );
      } finally {
        echoServer.close();
      }
    });
  });

  // ─── CONNECT tunnel — successful (no error headers) ─────────────────

  describe('CONNECT tunnel — successful (no error on reachable host)', () => {
    it('should return 200 with no X-Proxy-Error header for reachable host', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      try {
        const { statusCode, headers } = await new Promise<{
          statusCode: number;
          headers: Record<string, string>;
        }>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });
          req.on('connect', (res, socket) => {
            resolve({
              statusCode: res.statusCode!,
              headers: res.headers as Record<string, string>,
            });
            socket.destroy();
          });
          req.on('error', reject);
          req.end();
        });

        expect(statusCode).toBe(200);
        // No X-Proxy-Error header on success
        expect(headers['x-proxy-error']).toBeUndefined();
        expect(mocks.auditLogger.log).toHaveBeenCalledWith(
          expect.objectContaining({
            allowed: true,
            result: 'success',
            metadata: expect.objectContaining({ protocol: 'https', method: 'CONNECT' }),
          }),
        );
        // No error audit entries
        const errorCalls = mocks.auditLogger.log.mock.calls.filter(
          ([entry]: [any]) => entry.result === 'error',
        );
        expect(errorCalls).toHaveLength(0);
      } finally {
        echoServer.close();
      }
    });
  });

  // ─── CONNECT tunnel — upstream error ─────────────────────────────────

  describe('CONNECT tunnel — upstream connection error', () => {
    it('should return 502 with X-Proxy-Error header when tunnel fails', async () => {
      ({ server, port, mocks } = await startServer());

      // CONNECT to a host that will fail DNS resolution
      const { statusCode, headers } = await new Promise<{
        statusCode: number;
        headers: Record<string, string>;
      }>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: 'nonexistent.test.invalid:443',
        });
        req.on('connect', (res, socket) => {
          resolve({
            statusCode: res.statusCode!,
            headers: res.headers as Record<string, string>,
          });
          socket.destroy();
        });
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(502);
      expect(headers['x-proxy-error']).toBe('dns-resolution-failed');

      // Verify audit metadata includes errorType
      // Wait a tick for async audit logging
      await new Promise((r) => setTimeout(r, 100));
      expect(mocks.auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'error',
          metadata: expect.objectContaining({ errorType: 'dns-resolution-failed' }),
        }),
      );
    });
  });

  // ─── CONNECT — bad request (empty URL) ──────────────────────────────

  describe('CONNECT — bad request', () => {
    it('should return 400 when hostname is empty', async () => {
      ({ server, port, mocks } = await startServer());

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: ':443',
        });
        req.on('connect', (res, socket) => {
          socket.destroy();
          resolve(res);
        });
        req.on('error', reject);
        req.end();
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── HTTP proxy — allowed ───────────────────────────────────────────

  describe('HTTP proxy — allowed', () => {
    it('should proxy the request and return the target response', async () => {
      ({ server, port, mocks } = await startServer());
      const expectedBody = 'proxied-response-body';
      const { targetServer, targetPort } = await createTargetHttpServer(expectedBody);

      try {
        const body = await new Promise<string>((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port,
              method: 'GET',
              path: `http://127.0.0.1:${targetPort}/test`,
              headers: {
                'proxy-connection': 'keep-alive',
                'proxy-authorization': 'Basic dGVzdDp0ZXN0',
              },
            },
            (res) => {
              let data = '';
              res.on('data', (chunk) => (data += chunk));
              res.on('end', () => resolve(data));
            }
          );
          req.on('error', reject);
          req.end();
        });

        expect(body).toBe(expectedBody);
        expect(mocks.policyEnforcer.check).toHaveBeenCalledWith(
          'http_request',
          { url: `http://127.0.0.1:${targetPort}/test` },
          expect.objectContaining({ channel: 'http' })
        );
        expect(mocks.auditLogger.log).toHaveBeenCalledWith(
          expect.objectContaining({
            allowed: true,
            metadata: expect.objectContaining({ protocol: 'http', method: 'GET' }),
          })
        );
      } finally {
        targetServer.close();
      }
    });
  });

  // ─── HTTP proxy — denied ────────────────────────────────────────────

  describe('HTTP proxy — denied', () => {
    it('should return 403 with policy denial message', async () => {
      ({ server, port, mocks } = await startServer());
      mocks.policyEnforcer.check.mockResolvedValue({
        allowed: false,
        reason: 'not allowed',
      });

      const { statusCode, body } = await new Promise<{
        statusCode: number;
        body: string;
      }>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'GET',
            path: 'http://evil.com/data',
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({ statusCode: res.statusCode!, body: data })
            );
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(403);
      expect(body).toBe('Blocked by AgenShield URL policy');
    });
  });

  // ─── JSON-RPC ping still works ──────────────────────────────────────

  describe('JSON-RPC', () => {
    it('should handle ping requests on /rpc', async () => {
      ({ server, port, mocks } = await startServer());

      const { statusCode, json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
        params: {},
      });

      expect(statusCode).toBe(200);
      expect(json.jsonrpc).toBe('2.0');
      expect(json.id).toBe(1);
      expect(json.result).toBeDefined();
      expect(json.result.pong).toBe(true);
    });
  });

  // ─── Health check still works ───────────────────────────────────────

  describe('Health check', () => {
    it('should return { status: ok } on GET /health', async () => {
      ({ server, port, mocks } = await startServer());

      const { statusCode, json } = await new Promise<{
        statusCode: number;
        json: any;
      }>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'GET',
            path: '/health',
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              resolve({
                statusCode: res.statusCode!,
                json: JSON.parse(data),
              });
            });
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(200);
      expect(json.status).toBe('ok');
    });
  });

  // ─── Graceful shutdown destroys tunnels ─────────────────────────────

  describe('Graceful shutdown', () => {
    it('should destroy active tunnel sockets on stop()', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });
          req.on('connect', (_res, sock) => {
            resolve(sock as net.Socket);
          });
          req.on('error', reject);
          req.end();
        });

        // Socket should be open
        expect(socket.destroyed).toBe(false);

        // Stop the server — should destroy the tunnel
        await server.stop();

        // Give a tick for the destroy to propagate
        await new Promise((r) => setTimeout(r, 50));
        expect(socket.destroyed).toBe(true);

        // Prevent afterEach from calling stop() again
        server = null as any;
      } finally {
        echoServer.close();
      }
    });

    it('should resolve immediately if server is null (line 174)', async () => {
      const m = createMocks();
      const config = createConfig();
      const srv = new HttpFallbackServer({
        config: config as any,
        policyEnforcer: m.policyEnforcer as any,
        auditLogger: m.auditLogger as any,
        commandAllowlist: m.commandAllowlist as any,
      });

      // Never started, so internal server is null
      await expect(srv.stop()).resolves.toBeUndefined();
    });
  });

  // ─── handleRequest — 404 for unknown paths ──────────────────────────

  describe('handleRequest — 404 for unknown paths', () => {
    it('should return 404 for GET /unknown', async () => {
      ({ server, port, mocks } = await startServer());

      const { statusCode, body } = await new Promise<{
        statusCode: number;
        body: string;
      }>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'GET',
            path: '/unknown',
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({ statusCode: res.statusCode!, body: data })
            );
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(404);
      const json = JSON.parse(body);
      expect(json.error).toBe('Not found');
    });

    it('should return 404 for POST to non-/rpc path', async () => {
      ({ server, port, mocks } = await startServer());

      const { statusCode } = await new Promise<{
        statusCode: number;
        body: string;
      }>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/other',
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({ statusCode: res.statusCode!, body: data })
            );
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(404);
    });
  });

  // ─── handleRequest — 413 for body exceeding 10MB ────────────────────

  describe('handleRequest — body too large', () => {
    it('should return 413 when body exceeds 10MB', async () => {
      ({ server, port, mocks } = await startServer());

      const result = await new Promise<{ statusCode: number; body: string }>((resolve) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/rpc',
            headers: {
              'Content-Type': 'application/json',
              // Don't set Content-Length to allow streaming
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({ statusCode: res.statusCode!, body: data })
            );
          }
        );
        req.on('error', () => {
          // Server may reset connection after 413 — that's fine
        });

        // Write slightly over 10MB in one go
        const bigChunk = Buffer.alloc(10 * 1024 * 1024 + 100, 'X');
        req.end(bigChunk);
      });

      expect(result.statusCode).toBe(413);
      const json = JSON.parse(result.body);
      expect(json.error).toBe('Request too large');
    }, 15000);
  });

  // ─── processRequest — invalid JSON (-32700) ─────────────────────────

  describe('processRequest — parse errors', () => {
    it('should return -32700 for invalid JSON body', async () => {
      ({ server, port, mocks } = await startServer());

      const { statusCode, json } = await new Promise<{
        statusCode: number;
        json: any;
      }>((resolve, reject) => {
        const body = 'not valid json{{{';
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/rpc',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({ statusCode: res.statusCode!, json: JSON.parse(data) })
            );
          }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      expect(statusCode).toBe(200);
      expect(json.error.code).toBe(-32700);
      expect(json.error.message).toBe('Parse error');
    });
  });

  // ─── processRequest — invalid JSON-RPC (-32600) ─────────────────────

  describe('processRequest — invalid JSON-RPC structure', () => {
    it('should return -32600 for missing jsonrpc field', async () => {
      ({ server, port, mocks } = await startServer());

      const { json } = await rpcRequest(port, {
        id: 1,
        method: 'ping',
        params: {},
      });

      expect(json.error.code).toBe(-32600);
      expect(json.error.message).toBe('Invalid Request');
    });

    it('should return -32600 for missing method', async () => {
      ({ server, port, mocks } = await startServer());

      const { json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        id: 1,
        params: {},
      });

      expect(json.error.code).toBe(-32600);
      expect(json.error.message).toBe('Invalid Request');
    });

    it('should return -32600 for missing id', async () => {
      ({ server, port, mocks } = await startServer());

      const { json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        method: 'ping',
        params: {},
      });

      expect(json.error.code).toBe(-32600);
      expect(json.error.message).toBe('Invalid Request');
    });
  });

  // ─── processRequest — denied operations (1008) ──────────────────────

  describe('processRequest — privileged operations denied over HTTP', () => {
    it.each(['exec', 'file_write', 'secret_inject'])(
      'should return 1008 for %s',
      async (method) => {
        ({ server, port, mocks } = await startServer());

        const { json } = await rpcRequest(port, {
          jsonrpc: '2.0',
          id: 1,
          method,
          params: { command: 'ls', path: '/tmp/test', name: 'secret' },
        });

        expect(json.error.code).toBe(1008);
        expect(json.error.message).toContain('not allowed over HTTP');
        expect(json.error.message).toContain(method);

        // Verify audit logging for denied operations
        expect(mocks.auditLogger.log).toHaveBeenCalledWith(
          expect.objectContaining({
            allowed: false,
            result: 'denied',
            errorMessage: 'Operation not allowed over HTTP fallback',
          })
        );
      }
    );
  });

  // ─── processRequest — unknown method (-32601) ──────────────────────

  describe('processRequest — unknown method', () => {
    it('should return -32601 for unknown method', async () => {
      ({ server, port, mocks } = await startServer());

      const { json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'some_unknown_method',
        params: {},
      });

      expect(json.error.code).toBe(-32601);
      expect(json.error.message).toBe('Method not found');
    });
  });

  // ─── processRequest — policy_check bypasses policy enforcer ─────────

  describe('processRequest — policy_check bypass', () => {
    it('should bypass policy enforcer for policy_check method', async () => {
      ({ server, port, mocks } = await startServer());

      // Policy enforcer denies everything, but policy_check should bypass it
      mocks.policyEnforcer.check.mockResolvedValue({
        allowed: false,
        reason: 'denied',
      });

      const { json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'policy_check',
        params: { operation: 'exec', target: 'ls' },
      });

      // Should succeed because policy_check bypasses the enforcer
      expect(json.result).toBeDefined();
      expect(json.error).toBeUndefined();
    });
  });

  // ─── processRequest — policy denied with daemon forward ─────────────

  describe('processRequest — policy denied then daemon override', () => {
    it('should forward to daemon when broker denies, and use override if allowed', async () => {
      ({ server, port, mocks } = await startServer());

      mocks.policyEnforcer.check.mockResolvedValue({
        allowed: false,
        reason: 'broker says no',
      });
      mockForwardPolicyToDaemon.mockResolvedValueOnce({
        allowed: true,
        policyId: 'daemon-override',
      });

      const { json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
        params: {},
      });

      expect(json.result).toBeDefined();
      expect(json.error).toBeUndefined();
      expect(mockForwardPolicyToDaemon).toHaveBeenCalledWith(
        'ping',
        'ping',
        'http://127.0.0.1:5200',
        undefined,
        undefined
      );
    });

    it('should return 1001 when both broker and daemon deny', async () => {
      ({ server, port, mocks } = await startServer());

      mocks.policyEnforcer.check.mockResolvedValue({
        allowed: false,
        reason: 'broker says no',
      });
      mockForwardPolicyToDaemon.mockResolvedValueOnce(null);

      const { json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
        params: {},
      });

      expect(json.error).toBeDefined();
      expect(json.error.code).toBe(1001);
      expect(json.error.message).toContain('broker says no');

      // Should log the denial
      expect(mocks.auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          allowed: false,
          result: 'denied',
        })
      );
    });
  });

  // ─── processRequest — handler returns error ─────────────────────────

  describe('processRequest — handler returns error', () => {
    it('should return error response when handler fails', async () => {
      ({ server, port, mocks } = await startServer());

      (handlersMod.handlePing as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: { code: -32000, message: 'Something went wrong' },
      });

      const { json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        id: 42,
        method: 'ping',
        params: {},
      });

      expect(json.error).toBeDefined();
      expect(json.error.code).toBe(-32000);
      expect(json.error.message).toBe('Something went wrong');
      expect(json.id).toBe(42);
    });

    it('should use defaults when handler error has no code/message', async () => {
      ({ server, port, mocks } = await startServer());

      (handlersMod.handlePing as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: undefined,
      });

      const { json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        id: 99,
        method: 'ping',
        params: {},
      });

      expect(json.error.code).toBe(-32000);
      expect(json.error.message).toBe('Unknown error');
    });
  });

  // ─── processRequest — internal error catch ──────────────────────────

  describe('processRequest — internal error', () => {
    it('should return -32603 when handler throws', async () => {
      ({ server, port, mocks } = await startServer());

      (handlersMod.handlePing as jest.Mock).mockRejectedValueOnce(
        new Error('unexpected crash')
      );

      const { json } = await rpcRequest(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
        params: {},
      });

      expect(json.error.code).toBe(-32603);
      expect(json.error.message).toBe('Internal error');
    });
  });

  // ─── CONNECT tunnel — connection refused (serverSocket error) ───────

  describe('CONNECT tunnel — serverSocket error (connection refused)', () => {
    it('should return 502 when upstream connection is refused', async () => {
      ({ server, port, mocks } = await startServer());

      // Connect to a port that is definitely not listening
      const closedPort = await findClosedPort();

      const { statusCode, headers } = await new Promise<{
        statusCode: number;
        headers: Record<string, string>;
      }>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: `127.0.0.1:${closedPort}`,
        });
        req.on('connect', (res, socket) => {
          resolve({
            statusCode: res.statusCode!,
            headers: res.headers as Record<string, string>,
          });
          socket.destroy();
        });
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(502);
      expect(headers['x-proxy-error']).toBe('connection-refused');

      await new Promise((r) => setTimeout(r, 100));
      expect(mocks.auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'error',
          errorMessage: expect.stringContaining('TUNNEL connection-refused'),
        })
      );
    });
  });

  // ─── CONNECT tunnel — clientSocket error (pipe error) ───────────────

  describe('CONNECT tunnel — clientSocket error destroys serverSocket', () => {
    it('should clean up active tunnels when client socket closes with error', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });
          req.on('connect', (_res, sock) => {
            resolve(sock as net.Socket);
          });
          req.on('error', reject);
          req.end();
        });

        // Swallow errors on the socket (to avoid unhandled error)
        socket.on('error', () => { /* intentional */ });

        // Destroy the client socket to trigger the error path
        socket.destroy();

        // Give a tick for the destroy/close to propagate
        await new Promise((r) => setTimeout(r, 200));

        // The active tunnels set should be cleaned up
        const tunnels = (server as any).activeTunnels;
        expect(tunnels.size).toBe(0);
      } finally {
        echoServer.close();
      }
    });
  });

  // ─── HTTP proxy — 502 on upstream error ─────────────────────────────

  describe('HTTP proxy — upstream error', () => {
    it('should return 502 when upstream request fails', async () => {
      ({ server, port, mocks } = await startServer());

      // Proxy to a port that is not listening (connection refused)
      const closedPort = await findClosedPort();

      const { statusCode, body } = await new Promise<{
        statusCode: number;
        body: string;
      }>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'GET',
            path: `http://127.0.0.1:${closedPort}/test`,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({ statusCode: res.statusCode!, body: data })
            );
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(502);
      expect(body).toBe('Proxy error');

      await new Promise((r) => setTimeout(r, 100));
      expect(mocks.auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'error',
          errorMessage: expect.stringContaining('HTTP proxy error'),
        })
      );
    });
  });

  // ─── HTTP proxy — 400 for invalid URL ───────────────────────────────

  describe('HTTP proxy — invalid URL', () => {
    it('should return 400 for invalid URL', async () => {
      ({ server, port, mocks } = await startServer());

      // We need the URL to start with http:// to trigger handleHttpProxy,
      // but also be invalid enough to fail new URL() parsing.
      // Use a raw TCP connection to send a malformed absolute URL.
      const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          // URL that starts with http:// but is unparseable by `new URL()`
          socket.write(
            'GET http://[invalid HTTP/1.1\r\n' +
            'Host: whatever\r\n' +
            'Connection: close\r\n' +
            '\r\n'
          );
        });

        let data = '';
        socket.on('data', (chunk) => {
          data += chunk.toString();
        });
        socket.on('end', () => {
          const lines = data.split('\r\n');
          const statusLine = lines[0];
          const code = parseInt(statusLine.split(' ')[1]);
          resolve({ statusCode: code, body: data });
        });
        socket.on('error', reject);

        // Add a safety timeout
        setTimeout(() => {
          socket.destroy();
          reject(new Error('Timeout waiting for response'));
        }, 4000);
      });

      expect(result.statusCode).toBe(400);
      expect(result.body).toContain('Invalid URL');
    }, 10000);
  });

  // ─── HTTP proxy — DNS resolution failure ────────────────────────────

  describe('HTTP proxy — DNS resolution failure', () => {
    it('should return 403 when DNS resolution fails for HTTP proxy', async () => {
      ({ server, port, mocks } = await startServer());

      // Mock DNS to fail for the target hostname
      mockDnsLookup.mockRejectedValue(new Error('DNS resolution failed'));

      // Also ensure the Resolver mocks fail
      const mockResolver = {
        setServers: jest.fn(),
        resolve4: jest.fn().mockRejectedValue(new Error('resolve4 failed')),
        resolve6: jest.fn().mockRejectedValue(new Error('resolve6 failed')),
      };
      (Resolver as jest.MockedClass<typeof Resolver>).mockImplementation(() => mockResolver as any);

      const { statusCode, body, headers } = await new Promise<{
        statusCode: number;
        body: string;
        headers: Record<string, string>;
      }>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'GET',
            path: 'http://unresolvable-host.invalid/path',
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({
                statusCode: res.statusCode!,
                body: data,
                headers: res.headers as Record<string, string>,
              })
            );
          }
        );
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(403);
      expect(headers['x-proxy-error']).toBe('dns-resolution-failed');
      expect(body).toContain('DNS resolution failed');
    });
  });

  // ─── HTTP proxy — daemon override allows ────────────────────────────

  describe('HTTP proxy — daemon override allows denied request', () => {
    it('should forward to daemon when policy denies and accept override', async () => {
      ({ server, port, mocks } = await startServer());
      const expectedBody = 'overridden-body';
      const { targetServer, targetPort } = await createTargetHttpServer(expectedBody);

      try {
        mocks.policyEnforcer.check.mockResolvedValue({
          allowed: false,
          reason: 'broker denies',
        });
        mockForwardPolicyToDaemon.mockResolvedValueOnce({
          allowed: true,
          policyId: 'daemon-override-policy',
        });

        const body = await new Promise<string>((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port,
              method: 'GET',
              path: `http://127.0.0.1:${targetPort}/test`,
            },
            (res) => {
              let data = '';
              res.on('data', (chunk) => (data += chunk));
              res.on('end', () => resolve(data));
            }
          );
          req.on('error', reject);
          req.end();
        });

        expect(body).toBe(expectedBody);
        expect(mockForwardPolicyToDaemon).toHaveBeenCalled();
      } finally {
        targetServer.close();
      }
    });
  });

  // ─── isLocalhost — accepts ::ffff:127.0.0.1 ─────────────────────────

  describe('isLocalhost', () => {
    it('should accept ::ffff:127.0.0.1 as localhost', async () => {
      // Test isLocalhost by accessing the private method directly.
      const m = createMocks();
      const config = createConfig();
      const srv = new HttpFallbackServer({
        config: config as any,
        policyEnforcer: m.policyEnforcer as any,
        auditLogger: m.auditLogger as any,
        commandAllowlist: m.commandAllowlist as any,
      });

      const isLocalhost = (srv as any).isLocalhost.bind(srv);

      expect(isLocalhost('127.0.0.1')).toBe(true);
      expect(isLocalhost('::1')).toBe(true);
      expect(isLocalhost('::ffff:127.0.0.1')).toBe(true);
      expect(isLocalhost('localhost')).toBe(true);
      expect(isLocalhost('192.168.1.1')).toBe(false);
      expect(isLocalhost('10.0.0.1')).toBe(false);
      expect(isLocalhost(undefined)).toBe(false);
      expect(isLocalhost('')).toBe(false);
    });
  });

  // ─── resolveHostname — fallback paths ───────────────────────────────

  describe('resolveHostname — fallback DNS paths', () => {
    it('should return IP directly for numeric addresses (skip resolution)', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      try {
        // Use an IP address (127.0.0.1) — resolveHostname returns it immediately
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });
          req.on('connect', (res, socket) => {
            socket.destroy();
            resolve(res);
          });
          req.on('error', reject);
          req.end();
        });

        expect(response.statusCode).toBe(200);
        // DNS lookup should not be called for IP addresses
        expect(mockDnsLookup).not.toHaveBeenCalled();
      } finally {
        echoServer.close();
      }
    });

    it('should use system DNS when lookup succeeds (line 58)', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      // System DNS succeeds
      mockDnsLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 } as any);

      try {
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `resolvable.example:${echoPort}`,
          });
          req.on('connect', (res, socket) => {
            socket.destroy();
            resolve(res);
          });
          req.on('error', reject);
          req.end();
        });

        expect(response.statusCode).toBe(200);
        expect(mockDnsLookup).toHaveBeenCalledWith('resolvable.example');
      } finally {
        echoServer.close();
      }
    });

    it('should fall back to explicit DNS resolver when system resolver fails', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      // System DNS fails
      mockDnsLookup.mockRejectedValue(new Error('system DNS failed'));

      // Explicit resolver succeeds with IPv4
      const mockResolver = {
        setServers: jest.fn(),
        resolve4: jest.fn().mockResolvedValue(['127.0.0.1']),
        resolve6: jest.fn(),
      };
      (Resolver as jest.MockedClass<typeof Resolver>).mockImplementation(() => mockResolver as any);

      try {
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `some-hostname.example:${echoPort}`,
          });
          req.on('connect', (res, socket) => {
            socket.destroy();
            resolve(res);
          });
          req.on('error', reject);
          req.end();
        });

        // Should succeed via DNS fallback
        expect(response.statusCode).toBe(200);
        expect(mockDnsLookup).toHaveBeenCalled();
        expect(mockResolver.resolve4).toHaveBeenCalledWith('some-hostname.example');
      } finally {
        echoServer.close();
      }
    });

    it('should fall back to IPv6 DNS when IPv4 fails', async () => {
      ({ server, port, mocks } = await startServer());

      // System DNS fails
      mockDnsLookup.mockRejectedValue(new Error('system DNS failed'));

      // IPv4 resolver fails, IPv6 resolver succeeds
      let resolverCallCount = 0;
      const mockResolver4 = {
        setServers: jest.fn(),
        resolve4: jest.fn().mockRejectedValue(new Error('no A records')),
        resolve6: jest.fn(),
      };
      const mockResolver6 = {
        setServers: jest.fn(),
        resolve4: jest.fn(),
        resolve6: jest.fn().mockResolvedValue(['::1']),
      };

      (Resolver as jest.MockedClass<typeof Resolver>).mockImplementation(() => {
        resolverCallCount++;
        if (resolverCallCount === 1) return mockResolver4 as any;
        return mockResolver6 as any;
      });

      // We don't need the echo server to actually accept the connection;
      // we just need DNS resolution to succeed. The tunnel may fail to connect
      // to ::1 if the echoServer is on 127.0.0.1, but the DNS path is exercised.
      // Use a port that is closed so the CONNECT will get 502 after successful DNS.
      const closedPort = await findClosedPort();

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: `ipv6-host.example:${closedPort}`,
        });
        req.on('connect', (res, socket) => {
          socket.destroy();
          resolve(res);
        });
        req.on('error', reject);
        req.end();
      });

      // DNS resolved successfully, but connection to ::1:closedPort will fail
      // The important thing is that the IPv6 resolver was called
      expect(mockResolver4.resolve4).toHaveBeenCalled();
      expect(mockResolver6.resolve6).toHaveBeenCalled();
    });

    it('should throw when all resolvers fail', async () => {
      ({ server, port, mocks } = await startServer());

      // System DNS fails
      mockDnsLookup.mockRejectedValue(new Error('system DNS failed'));

      // All resolvers fail
      const mockResolver = {
        setServers: jest.fn(),
        resolve4: jest.fn().mockRejectedValue(new Error('resolve4 failed')),
        resolve6: jest.fn().mockRejectedValue(new Error('resolve6 failed')),
      };
      (Resolver as jest.MockedClass<typeof Resolver>).mockImplementation(() => mockResolver as any);

      const { statusCode, headers } = await new Promise<{
        statusCode: number;
        headers: Record<string, string>;
      }>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: 'totally-unresolvable.example:443',
        });
        req.on('connect', (res, socket) => {
          resolve({
            statusCode: res.statusCode!,
            headers: res.headers as Record<string, string>,
          });
          socket.destroy();
        });
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(502);
      expect(headers['x-proxy-error']).toBe('dns-resolution-failed');
    });

    it('should return first address when resolve4 returns results (line 68)', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      // System DNS fails
      mockDnsLookup.mockRejectedValue(new Error('system DNS failed'));

      // Explicit IPv4 resolver succeeds with multiple addresses
      const mockResolver = {
        setServers: jest.fn(),
        resolve4: jest.fn().mockResolvedValue(['127.0.0.1', '10.0.0.1']),
        resolve6: jest.fn(),
      };
      (Resolver as jest.MockedClass<typeof Resolver>).mockImplementation(() => mockResolver as any);

      try {
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `multi-addr.example:${echoPort}`,
          });
          req.on('connect', (res, socket) => {
            socket.destroy();
            resolve(res);
          });
          req.on('error', reject);
          req.end();
        });

        expect(response.statusCode).toBe(200);
        // First address (127.0.0.1) was used to connect to the echo server
      } finally {
        echoServer.close();
      }
    });
  });

  // ─── CONNECT tunnel — non-localhost rejected ────────────────────────

  describe('CONNECT tunnel — non-localhost rejected', () => {
    it('should reject CONNECT from non-localhost (verified via isLocalhost)', async () => {
      // We test this indirectly: the isLocalhost method returns false for external IPs.
      // In real usage, a remote client would get 403. We've already verified isLocalhost directly.
      // Here we verify the CONNECT 403 path for non-localhost is covered via the mock.
      const m = createMocks();
      const config = createConfig();
      const srv = new HttpFallbackServer({
        config: config as any,
        policyEnforcer: m.policyEnforcer as any,
        auditLogger: m.auditLogger as any,
        commandAllowlist: m.commandAllowlist as any,
      });

      // Access the private handleConnect method to simulate non-localhost
      const handleConnect = (srv as any).handleConnect.bind(srv);
      const clientSocket = new net.Socket();
      const mockReq = {
        url: 'example.com:443',
        socket: { remoteAddress: '10.0.0.5' },
      } as any;

      // Spy on clientSocket.write and destroy
      const writeSpy = jest.spyOn(clientSocket, 'write').mockImplementation(() => true);
      const destroySpy = jest.spyOn(clientSocket, 'destroy').mockImplementation(() => clientSocket);

      await handleConnect(mockReq, clientSocket, Buffer.alloc(0));

      expect(writeSpy).toHaveBeenCalledWith('HTTP/1.1 403 Forbidden\r\n\r\n');
      expect(destroySpy).toHaveBeenCalled();
    });
  });

  // ─── HTTP proxy — non-localhost rejected ────────────────────────────

  describe('HTTP proxy — non-localhost rejected', () => {
    it('should reject HTTP proxy from non-localhost address', async () => {
      const m = createMocks();
      const config = createConfig();
      const srv = new HttpFallbackServer({
        config: config as any,
        policyEnforcer: m.policyEnforcer as any,
        auditLogger: m.auditLogger as any,
        commandAllowlist: m.commandAllowlist as any,
      });

      // Access the private handleHttpProxy method to simulate non-localhost
      const handleHttpProxy = (srv as any).handleHttpProxy.bind(srv);
      const mockReq = {
        url: 'http://example.com/path',
        method: 'GET',
        headers: {},
        socket: { remoteAddress: '192.168.1.100' },
        pipe: jest.fn(),
      } as any;
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
        headersSent: false,
      } as any;

      await handleHttpProxy(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(403, { 'Content-Type': 'text/plain' });
      expect(mockRes.end).toHaveBeenCalledWith('Access denied: localhost only');
    });
  });

  // ─── handleRequest — non-localhost rejected ─────────────────────────

  describe('handleRequest — non-localhost rejected', () => {
    it('should reject POST /rpc from non-localhost address', async () => {
      const m = createMocks();
      const config = createConfig();
      const srv = new HttpFallbackServer({
        config: config as any,
        policyEnforcer: m.policyEnforcer as any,
        auditLogger: m.auditLogger as any,
        commandAllowlist: m.commandAllowlist as any,
      });

      // Access the private handleRequest method
      const handleRequest = (srv as any).handleRequest.bind(srv);

      const mockReq = {
        url: '/rpc',
        method: 'POST',
        socket: { remoteAddress: '10.0.0.5' },
        [Symbol.asyncIterator]: async function* () {
          yield '{}';
        },
      } as any;
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
      } as any;

      await handleRequest(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(403, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Access denied: localhost only' }));
    });
  });

  // ─── HTTP proxy — host header handling ───────────────────────────────

  describe('HTTP proxy — host header handling', () => {
    it('should preserve Host header when proxying HTTP requests', async () => {
      ({ server, port, mocks } = await startServer());
      const expectedBody = 'host-test-ok';

      let receivedHost = '';
      const targetServer = await new Promise<{ srv: http.Server; port: number }>((resolve) => {
        const srv = http.createServer((req, res) => {
          receivedHost = req.headers.host || '';
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(expectedBody);
        });
        srv.listen(0, '127.0.0.1', () => {
          const addr = srv.address() as net.AddressInfo;
          resolve({ srv, port: addr.port });
        });
      });

      try {
        const body = await new Promise<string>((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port,
              method: 'GET',
              path: `http://127.0.0.1:${targetServer.port}/test`,
            },
            (res) => {
              let data = '';
              res.on('data', (chunk) => (data += chunk));
              res.on('end', () => resolve(data));
            }
          );
          req.on('error', reject);
          req.end();
        });

        expect(body).toBe(expectedBody);
        // Target server should have received some Host header
        expect(receivedHost).toBeTruthy();
      } finally {
        targetServer.srv.close();
      }
    });

  });

  // ─── start() — server error rejects ──────────────────────────────────

  describe('start() — server error', () => {
    it('should reject when server emits error on start', async () => {
      // Start a server on an ephemeral port first
      ({ server, port, mocks } = await startServer());

      // Try to start another server on the same port — should fail with EADDRINUSE
      const config = createConfig({ httpPort: port });
      const mocks2 = createMocks();
      const server2 = new HttpFallbackServer({
        config: config as any,
        policyEnforcer: mocks2.policyEnforcer as any,
        auditLogger: mocks2.auditLogger as any,
        commandAllowlist: mocks2.commandAllowlist as any,
      });

      await expect(server2.start()).rejects.toThrow();
    });
  });

  // ─── CONNECT tunnel — clientSocket error destroys serverSocket (actual error event) ──

  describe('CONNECT tunnel — clientSocket error event', () => {
    it('should destroy serverSocket when clientSocket emits error', async () => {
      ({ server, port, mocks } = await startServer());
      const { echoServer, echoPort } = await createEchoServer();

      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });
          req.on('connect', (_res, sock) => {
            resolve(sock as net.Socket);
          });
          req.on('error', reject);
          req.end();
        });

        // Swallow errors on the socket (our test-side socket)
        socket.on('error', () => { /* intentional */ });

        // Use resetAndDestroy to send TCP RST which triggers error on the proxy side
        if (typeof socket.resetAndDestroy === 'function') {
          socket.resetAndDestroy();
        } else {
          // Fallback: destroy with an error
          socket.destroy(new Error('simulated client error'));
        }

        // Wait for error to propagate
        await new Promise((r) => setTimeout(r, 300));

        // The tunnel should be cleaned up
        const tunnels = (server as any).activeTunnels;
        expect(tunnels.size).toBe(0);
      } finally {
        echoServer.close();
      }
    });
  });
});
