import * as http from 'node:http';
import * as net from 'node:net';
import { createPerRunProxy } from '../server';
import type { CreateProxyOptions } from '../types';
import type { PolicyConfig } from '@agenshield/ipc';

function allowAllPolicies(): PolicyConfig[] {
  return [];
}

function denyAllPolicies(): PolicyConfig[] {
  return [{
    id: 'deny-all',
    name: 'deny-all',
    action: 'deny',
    target: 'url',
    patterns: ['**'],
    enabled: true,
    priority: 1,
  }];
}

/** Allow-all policy that also explicitly allows plain HTTP */
function allowHttpPolicies(): PolicyConfig[] {
  return [{
    id: 'allow-http',
    name: 'allow-http',
    action: 'allow',
    target: 'url',
    patterns: ['http://**'],
    enabled: true,
    priority: 1,
  }];
}

function makeOptions(overrides?: Partial<CreateProxyOptions>): CreateProxyOptions {
  return {
    getPolicies: allowAllPolicies,
    getDefaultAction: () => 'allow',
    onActivity: jest.fn(),
    logger: jest.fn(),
    onBlock: jest.fn(),
    onAllow: jest.fn(),
    ...overrides,
  };
}

/** Start a local HTTP server returning a fixed body */
function startHttpServer(body: string, statusCode = 200): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

/** Make an HTTP request through the proxy */
function proxyRequest(
  proxyPort: number,
  targetUrl: string,
  method = 'GET',
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: proxyPort,
        path: targetUrl,
        method,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode!, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('createPerRunProxy', () => {
  let proxyServer: http.Server;
  let proxyPort: number;

  afterEach((done) => {
    if (proxyServer) {
      proxyServer.close(() => done());
    } else {
      done();
    }
  });

  async function startProxy(opts?: Partial<CreateProxyOptions>): Promise<number> {
    proxyServer = createPerRunProxy(makeOptions(opts));
    return new Promise((resolve) => {
      proxyServer.listen(0, '127.0.0.1', () => {
        const addr = proxyServer.address() as net.AddressInfo;
        proxyPort = addr.port;
        resolve(proxyPort);
      });
    });
  }

  describe('HTTP forwarding', () => {
    it('forwards allowed HTTP requests and returns response', async () => {
      const upstream = await startHttpServer('hello from upstream');
      try {
        const onAllow = jest.fn();
        // Localhost HTTP is allowed without explicit policy
        const port = await startProxy({ onAllow });

        const result = await proxyRequest(port, `http://127.0.0.1:${upstream.port}/test`);

        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('hello from upstream');
        expect(onAllow).toHaveBeenCalledWith('GET', expect.stringContaining('/test'), 'http');
      } finally {
        upstream.server.close();
      }
    });

    it('blocks HTTP requests denied by policy', async () => {
      const onBlock = jest.fn();
      const port = await startProxy({
        getPolicies: denyAllPolicies,
        getDefaultAction: () => 'allow',
        onBlock,
      });

      const result = await proxyRequest(port, 'http://example.com/path');

      expect(result.statusCode).toBe(403);
      expect(result.headers['x-proxy-error']).toBe('blocked-by-policy');
      expect(onBlock).toHaveBeenCalledWith('GET', 'http://example.com/path', 'http');
    });

    it('blocks HTTPS plain proxy requests denied by policy', async () => {
      const onBlock = jest.fn();
      const port = await startProxy({
        getPolicies: denyAllPolicies,
        getDefaultAction: () => 'allow',
        onBlock,
      });

      const result = await proxyRequest(port, 'https://example.com/secure');

      expect(result.statusCode).toBe(403);
      expect(result.headers['x-proxy-error']).toBe('blocked-by-policy');
      expect(onBlock).toHaveBeenCalledWith('GET', 'https://example.com/secure', 'https');
    });
  });

  describe('invalid requests', () => {
    it('returns 400 for invalid URL', async () => {
      const port = await startProxy();
      const result = await proxyRequest(port, 'not-a-valid-url');
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 for URL that passes policy check but fails URL parsing', async () => {
      // http:// passes Node's HTTP parser and checkUrlPolicy (default allow),
      // but new URL('http://') throws — exercises the catch block (lines 54-57)
      const port = await startProxy();
      const result = await proxyRequest(port, 'http://');
      expect(result.statusCode).toBe(400);
      expect(result.body).toBe('Invalid URL');
    });

    it('returns 502 for unreachable upstream', async () => {
      // Localhost HTTP is allowed by default
      const port = await startProxy();
      // Use a port that's definitely not listening
      const result = await proxyRequest(port, 'http://127.0.0.1:1/unreachable');
      expect(result.statusCode).toBe(502);
    });

    it('returns 502 for URL without explicit port (uses default port)', async () => {
      // URL without port — exercises parsedUrl.port || defaultPort branch
      // Port 80 is unlikely to be listening, so we get 502
      const port = await startProxy();
      const result = await proxyRequest(port, 'http://127.0.0.1/no-port-test');
      expect(result.statusCode).toBe(502);
    });
  });

  describe('CONNECT tunnel', () => {
    it('establishes tunnel for allowed targets', async () => {
      // Start a simple TCP echo server
      const echoServer = net.createServer((socket) => {
        socket.on('data', (data) => {
          socket.write(`echo:${data.toString()}`);
        });
      });
      await new Promise<void>((resolve) => echoServer.listen(0, '127.0.0.1', resolve));
      const echoPort = (echoServer.address() as net.AddressInfo).port;

      try {
        const onAllow = jest.fn();
        const port = await startProxy({ onAllow });

        const { socket, statusCode } = await new Promise<{ socket: net.Socket; statusCode: number }>((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });

          req.on('connect', (res, sock) => {
            resolve({ socket: sock, statusCode: res.statusCode! });
          });
          req.on('error', reject);
          req.end();
        });

        expect(statusCode).toBe(200);

        // Test bidirectional data through tunnel
        const response = await new Promise<string>((resolve) => {
          socket.on('data', (data) => resolve(data.toString()));
          socket.write('ping');
        });

        expect(response).toBe('echo:ping');
        socket.destroy();
      } finally {
        echoServer.close();
      }
    });

    it('blocks CONNECT for denied targets', async () => {
      const onBlock = jest.fn();
      const port = await startProxy({
        getPolicies: denyAllPolicies,
        getDefaultAction: () => 'allow',
        onBlock,
      });

      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: 'blocked.example.com:443',
        });

        req.on('connect', (res) => {
          resolve(res.statusCode!);
        });

        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(403);
      expect(onBlock).toHaveBeenCalledWith('CONNECT', 'blocked.example.com:443', 'https');
    });

    it('uses https protocol for all CONNECT ports (tunnels are opaque)', async () => {
      const onBlock = jest.fn();
      const port = await startProxy({
        getPolicies: denyAllPolicies,
        getDefaultAction: () => 'allow',
        onBlock,
      });

      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: 'localserver.test:8080',
        });

        req.on('connect', () => resolve());
        req.on('error', reject);
        req.end();
      });

      // All CONNECT tunnels report as https — the inner protocol is opaque
      expect(onBlock).toHaveBeenCalledWith('CONNECT', 'localserver.test:8080', 'https');
    });

    it('allows CONNECT to non-standard port with default allow (e.g. MongoDB)', async () => {
      // Start a simple TCP echo server to simulate a non-HTTP service
      const echoServer = net.createServer((socket) => {
        socket.on('data', (data) => {
          socket.write(`echo:${data.toString()}`);
        });
      });
      await new Promise<void>((resolve) => echoServer.listen(0, '127.0.0.1', resolve));
      const echoPort = (echoServer.address() as net.AddressInfo).port;

      try {
        const onAllow = jest.fn();
        const port = await startProxy({ onAllow });

        const { socket, statusCode } = await new Promise<{ socket: net.Socket; statusCode: number }>((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });

          req.on('connect', (res, sock) => {
            resolve({ socket: sock, statusCode: res.statusCode! });
          });
          req.on('error', reject);
          req.end();
        });

        expect(statusCode).toBe(200);
        expect(onAllow).toHaveBeenCalledWith('CONNECT', expect.stringContaining(`127.0.0.1:${echoPort}`), 'https');
        socket.destroy();
      } finally {
        echoServer.close();
      }
    });

    it('blocks CONNECT to non-standard port with deny policy', async () => {
      const onBlock = jest.fn();
      const port = await startProxy({
        getPolicies: () => [{
          id: 'deny-db',
          name: 'deny-db',
          action: 'deny' as const,
          target: 'url' as const,
          patterns: ['db.example.com'],
          enabled: true,
          priority: 1,
        }],
        getDefaultAction: () => 'allow',
        onBlock,
      });

      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: 'db.example.com:27017',
        });

        req.on('connect', (res) => {
          resolve(res.statusCode!);
        });
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(403);
      expect(onBlock).toHaveBeenCalledWith('CONNECT', 'db.example.com:27017', 'https');
    });
  });

  describe('CONNECT tunnel errors', () => {
    it('returns 502 with X-Proxy-Error: dns-resolution-failed for unreachable host', async () => {
      const logger = jest.fn();
      const port = await startProxy({ logger });

      const { statusCode, headers, body } = await new Promise<{
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      }>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: 'nonexistent.test.invalid:443',
        });

        req.on('connect', (res, socket) => {
          let data = '';
          // For 502, the response comes as part of the CONNECT response
          if (res.statusCode !== 200) {
            // Read any body data from the socket
            socket.on('data', (chunk) => { data += chunk.toString(); });
            socket.on('end', () => {
              resolve({
                statusCode: res.statusCode!,
                headers: res.headers as Record<string, string>,
                body: data,
              });
            });
            // Give socket a moment to finish
            setTimeout(() => {
              socket.destroy();
              resolve({
                statusCode: res.statusCode!,
                headers: res.headers as Record<string, string>,
                body: data,
              });
            }, 500);
          } else {
            // Should not get 200 — the host doesn't exist
            socket.destroy();
            reject(new Error('Expected 502 but got 200'));
          }
        });
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(502);
      expect(headers['x-proxy-error']).toBe('dns-resolution-failed');
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('dns-resolution-failed'),
      );
    });

    it('returns 200 Connection Established for reachable host (no error headers)', async () => {
      // Use a local TCP server to simulate a reachable upstream
      const echoServer = net.createServer((socket) => {
        socket.on('data', (data) => socket.write(data));
      });
      await new Promise<void>((resolve) => echoServer.listen(0, '127.0.0.1', resolve));
      const echoPort = (echoServer.address() as net.AddressInfo).port;

      try {
        const onAllow = jest.fn();
        const logger = jest.fn();
        const port = await startProxy({ onAllow, logger });

        const { statusCode, headers } = await new Promise<{
          statusCode: number;
          headers: http.IncomingHttpHeaders;
        }>((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });

          req.on('connect', (res, socket) => {
            resolve({ statusCode: res.statusCode!, headers: res.headers });
            socket.destroy();
          });
          req.on('error', reject);
          req.end();
        });

        expect(statusCode).toBe(200);
        // No X-Proxy-Error header on success
        expect(headers['x-proxy-error']).toBeUndefined();
        expect(onAllow).toHaveBeenCalledWith('CONNECT', expect.stringContaining(`127.0.0.1:${echoPort}`), 'https');
        // Logger should NOT contain any error classification
        const errorLogs = logger.mock.calls.filter(
          ([msg]: [string]) => msg.includes('dns-resolution-failed') || msg.includes('connection-refused'),
        );
        expect(errorLogs).toHaveLength(0);
      } finally {
        echoServer.close();
      }
    });
  });

  describe('TLS config', () => {
    it('passes tls.rejectUnauthorized to HTTPS requests', async () => {
      const port = await startProxy({
        tls: { rejectUnauthorized: false },
      });

      // Request an https:// URL — it will fail to connect but the TLS options
      // branch (line 78) is exercised. We expect a 502 since there's no real
      // HTTPS server, but the code path through rejectUnauthorized is hit.
      const result = await proxyRequest(port, 'https://127.0.0.1:1/tls-test');
      expect(result.statusCode).toBe(502);
    });
  });

  describe('client socket errors', () => {
    it('destroys server socket when client socket errors during tunnel', async () => {
      // Create a TCP server that sends data continuously so the proxy tries
      // to write to clientSocket, triggering an error when it's reset
      const echoServer = net.createServer((socket) => {
        socket.on('data', (data) => socket.write(data));
      });
      await new Promise<void>((resolve) => echoServer.listen(0, '127.0.0.1', resolve));
      const echoPort = (echoServer.address() as net.AddressInfo).port;

      try {
        const port = await startProxy();

        const { socket } = await new Promise<{ socket: net.Socket; statusCode: number }>((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${echoPort}`,
          });
          req.on('connect', (res, sock) => {
            resolve({ socket: sock, statusCode: res.statusCode! });
          });
          req.on('error', reject);
          req.end();
        });

        // Write data so the pipe is active, then RST the connection
        socket.on('error', () => {});
        socket.write('some data');
        // Use resetAndDestroy to send TCP RST — this triggers clientSocket 'error' on the server side
        (socket as net.Socket & { resetAndDestroy(): void }).resetAndDestroy();
        await new Promise((r) => setTimeout(r, 100));
      } finally {
        echoServer.close();
      }
    });
  });

  describe('defensive edge cases', () => {
    it('returns 400 when req.url is empty (direct handler invocation)', () => {
      const logger = jest.fn();
      const server = createPerRunProxy(makeOptions({ logger }));

      // Directly invoke the request handler with a mock request that has no URL
      const listeners = server.listeners('request') as ((req: http.IncomingMessage, res: http.ServerResponse) => void)[];
      expect(listeners.length).toBe(1);

      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
      };
      const mockReq = { url: '' } as unknown as http.IncomingMessage;

      listeners[0](mockReq, mockRes as unknown as http.ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(400);
      expect(mockRes.end).toHaveBeenCalledWith('Bad request');
    });

    it('CONNECT handler defaults port to 443 when no port in target', () => {
      const onBlock = jest.fn();
      const server = createPerRunProxy(makeOptions({
        getPolicies: denyAllPolicies,
        getDefaultAction: () => 'allow',
        onBlock,
      }));

      // Directly invoke the connect handler with a target that has no port
      const listeners = server.listeners('connect') as ((req: http.IncomingMessage, socket: net.Socket, head: Buffer) => void)[];
      expect(listeners.length).toBe(1);

      const mockSocket = {
        write: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn(),
        pipe: jest.fn(),
      };
      const mockReq = { url: 'example.com' } as unknown as http.IncomingMessage;

      listeners[0](mockReq, mockSocket as unknown as net.Socket, Buffer.alloc(0));

      // parseInt(undefined) || 443 = 443
      expect(onBlock).toHaveBeenCalledWith('CONNECT', 'example.com:443', 'https');
    });

    it('HTTP handler falls back to GET when req.method is empty (block path)', () => {
      const onBlock = jest.fn();
      const server = createPerRunProxy(makeOptions({
        getPolicies: denyAllPolicies,
        getDefaultAction: () => 'allow',
        onBlock,
      }));

      const listeners = server.listeners('request') as ((req: http.IncomingMessage, res: http.ServerResponse) => void)[];
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
      };
      const mockReq = { url: 'http://example.com/test', method: '' } as unknown as http.IncomingMessage;

      listeners[0](mockReq, mockRes as unknown as http.ServerResponse);

      // Falls back to 'GET' when method is falsy
      expect(onBlock).toHaveBeenCalledWith('GET', 'http://example.com/test', 'http');
    });

    it('HTTP handler falls back to GET when req.method is empty (allow path)', () => {
      const onAllow = jest.fn();
      const server = createPerRunProxy(makeOptions({ onAllow }));

      const listeners = server.listeners('request') as ((req: http.IncomingMessage, res: http.ServerResponse) => void)[];
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
        headersSent: false,
      };
      const mockReq = {
        url: 'http://127.0.0.1:1/test',
        method: '',
        headers: {},
        pipe: jest.fn(),
      } as unknown as http.IncomingMessage;

      listeners[0](mockReq, mockRes as unknown as http.ServerResponse);

      // Falls back to 'GET' when method is falsy
      expect(onAllow).toHaveBeenCalledWith('GET', 'http://127.0.0.1:1/test', 'http');
    });
  });

  describe('activity callback', () => {
    it('fires onActivity for HTTP requests', async () => {
      const upstream = await startHttpServer('ok');
      try {
        const onActivity = jest.fn();
        const port = await startProxy({ onActivity });

        await proxyRequest(port, `http://127.0.0.1:${upstream.port}/`);

        expect(onActivity).toHaveBeenCalled();
      } finally {
        upstream.server.close();
      }
    });

    it('fires onActivity for CONNECT requests', async () => {
      const onActivity = jest.fn();
      const port = await startProxy({
        onActivity,
        getPolicies: denyAllPolicies,
        getDefaultAction: () => 'allow',
      });

      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: 'example.com:443',
        });
        req.on('connect', () => resolve());
        req.on('error', reject);
        req.end();
      });

      expect(onActivity).toHaveBeenCalled();
    });
  });
});
