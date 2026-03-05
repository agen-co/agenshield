import * as http from 'node:http';
import * as net from 'node:net';
import { HttpFallbackServer } from '../http-fallback.js';

// Mock daemon-forward module
jest.mock('../daemon-forward.js', () => ({
  forwardPolicyToDaemon: jest.fn().mockResolvedValue(null),
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

import { forwardPolicyToDaemon } from '../daemon-forward.js';

const mockForwardPolicyToDaemon = forwardPolicyToDaemon as jest.MockedFunction<
  typeof forwardPolicyToDaemon
>;

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

describe('HttpFallbackServer', () => {
  let server: HttpFallbackServer;
  let port: number;
  let mocks: MockDeps;

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
      mocks.policyEnforcer.check.mockResolvedValue({
        allowed: false,
        reason: 'no matching policy',
      });
      mockForwardPolicyToDaemon.mockResolvedValueOnce({
        allowed: true,
        policyId: 'daemon-policy',
      });

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: 'api.anthropic.com:443',
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
        'https://api.anthropic.com',
        expect.any(String),
        undefined,
        undefined
      );
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

      const { statusCode, json } = await new Promise<{
        statusCode: number;
        json: any;
      }>((resolve, reject) => {
        const payload = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping',
          params: {},
        });
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/rpc',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
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
        req.write(payload);
        req.end();
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
  });
});
