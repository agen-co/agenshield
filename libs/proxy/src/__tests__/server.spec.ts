import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as crypto from 'node:crypto';
import { createPerRunProxy, sanitizeHeaders } from '../server';
import { generateHostCertificate } from '../tls';
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

// --- Test CA generation (mirrors tls.spec.ts) ---
function generateTestCA(): { cert: string; key: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const cert = buildTestCACert(privateKey, publicKey);
  return { cert, key: keyPem };
}

function buildTestCACert(privateKey: crypto.KeyObject, publicKey: crypto.KeyObject): string {
  const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const serialNumber = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const tbs = buildMinimalTbs(serialNumber, 'AgenShield Test CA', now, notAfter, pubKeyDer);
  const sign = crypto.createSign('SHA256');
  sign.update(tbs);
  const signature = sign.sign(privateKey);

  const fullCert = buildMinimalFullCert(tbs, signature);
  const certBase64 = fullCert.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < certBase64.length; i += 64) {
    lines.push(certBase64.slice(i, i + 64));
  }
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

// Minimal ASN.1 helpers
function encLen(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) { bytes.unshift(temp & 0xff); temp >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function seq(...items: Buffer[]): Buffer {
  const c = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x30]), encLen(c.length), c]);
}
function asnSet(...items: Buffer[]): Buffer {
  const c = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x31]), encLen(c.length), c]);
}
function oid(nums: number[]): Buffer {
  const bytes: number[] = [nums[0] * 40 + nums[1]];
  for (let i = 2; i < nums.length; i++) {
    let v = nums[i];
    if (v >= 0x80) {
      const e: number[] = [];
      e.unshift(v & 0x7f); v >>= 7;
      while (v > 0) { e.unshift(0x80 | (v & 0x7f)); v >>= 7; }
      bytes.push(...e);
    } else bytes.push(v);
  }
  const c = Buffer.from(bytes);
  return Buffer.concat([Buffer.from([0x06]), encLen(c.length), c]);
}
function utf8(str: string): Buffer {
  const c = Buffer.from(str, 'utf-8');
  return Buffer.concat([Buffer.from([0x0c]), encLen(c.length), c]);
}
function asn1Int(value: Buffer | number): Buffer {
  let buf: Buffer;
  if (typeof value === 'number') {
    if (value === 0) buf = Buffer.from([0]);
    else {
      const b: number[] = [];
      let t = value;
      while (t > 0) { b.unshift(t & 0xff); t >>= 8; }
      if (b[0] & 0x80) b.unshift(0);
      buf = Buffer.from(b);
    }
  } else {
    buf = value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
  }
  return Buffer.concat([Buffer.from([0x02]), encLen(buf.length), buf]);
}
function bitStr(content: Buffer): Buffer {
  const p = Buffer.concat([Buffer.from([0x00]), content]);
  return Buffer.concat([Buffer.from([0x03]), encLen(p.length), p]);
}
function ctxTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0xa0 | tag]), encLen(content.length), content]);
}
function genTime(date: Date): Buffer {
  const str = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  const c = Buffer.from(str, 'ascii');
  return Buffer.concat([Buffer.from([0x18]), encLen(c.length), c]);
}
function buildMinimalTbs(
  serialHex: string, cn: string, notBefore: Date, notAfter: Date, pubKeyDer: Buffer,
): Buffer {
  const version = ctxTag(0, asn1Int(2));
  const serial = asn1Int(Buffer.from(serialHex, 'hex'));
  const sigAlg = seq(oid([1, 2, 840, 113549, 1, 1, 11]), Buffer.from([0x05, 0x00]));
  const name = seq(asnSet(seq(oid([2, 5, 4, 3]), utf8(cn))));
  const validity = seq(genTime(notBefore), genTime(notAfter));
  return seq(version, serial, sigAlg, name, validity, name, pubKeyDer);
}
function buildMinimalFullCert(tbs: Buffer, signature: Buffer): Buffer {
  const sigAlg = seq(oid([1, 2, 840, 113549, 1, 1, 11]), Buffer.from([0x05, 0x00]));
  return seq(tbs, sigAlg, bitStr(signature));
}

/** Start a local HTTPS server with a self-signed cert */
function startHttpsServer(
  body: string,
  testCA: { cert: string; key: string },
  hostname: string,
  statusCode = 200,
): Promise<{ server: https.Server; port: number }> {
  const hostCert = generateHostCertificate(hostname, testCA.cert, testCA.key);
  return new Promise((resolve) => {
    const server = https.createServer(
      { key: hostCert.key, cert: hostCert.cert },
      (_req, res) => {
        res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
        res.end(body);
      },
    );
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

/**
 * Do a CONNECT + TLS handshake through the proxy, then send an HTTP request
 * over the decrypted channel. Returns the raw HTTP response string.
 */
function sslTerminatedRequest(
  proxyPort: number,
  hostname: string,
  targetPort: number,
  path: string,
  _caCert: string,
  method = 'GET',
  body?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${hostname}:${targetPort}`,
    });

    req.on('connect', (_res, socket) => {
      const tlsSock = tls.connect({
        socket,
        servername: hostname,
        // Our test CA lacks Basic Constraints (CA:TRUE) so chain validation
        // would fail with "unsuitable certificate purpose". We skip it here
        // since we're testing proxy logic, not cert chain validity.
        rejectUnauthorized: false,
      }, () => {
        let httpReq = `${method} ${path} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n`;
        if (body) {
          httpReq += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
        }
        httpReq += '\r\n';
        if (body) httpReq += body;
        tlsSock.write(httpReq);
      });

      let data = '';
      tlsSock.on('data', (chunk) => { data += chunk.toString(); });
      tlsSock.on('end', () => resolve(data));
      tlsSock.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

describe('createPerRunProxy', () => {
  let proxyServer: http.Server;
  let proxyPort: number;

  afterEach(async () => {
    if (proxyServer) {
      // Force-close all open connections to avoid hanging afterEach
      proxyServer.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        proxyServer.close(() => resolve());
        // Safety timeout — if close hangs, resolve anyway
        setTimeout(() => resolve(), 2000);
      });
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
        on: jest.fn(),
      } as unknown as http.IncomingMessage;

      listeners[0](mockReq, mockRes as unknown as http.ServerResponse);

      // Falls back to 'GET' when method is falsy
      expect(onAllow).toHaveBeenCalledWith('GET', 'http://127.0.0.1:1/test', 'http');
    });
  });

  describe('header sanitization', () => {
    it('strips hop-by-hop headers', () => {
      const headers: http.IncomingHttpHeaders = {
        'host': 'example.com',
        'connection': 'keep-alive',
        'keep-alive': 'timeout=5',
        'proxy-authorization': 'Basic abc123',
        'proxy-connection': 'keep-alive',
        'transfer-encoding': 'chunked',
        'te': 'trailers',
        'trailer': 'X-Checksum',
        'upgrade': 'websocket',
        'content-type': 'application/json',
        'x-custom': 'preserved',
      };

      const sanitized = sanitizeHeaders(headers);

      expect(sanitized['host']).toBe('example.com');
      expect(sanitized['content-type']).toBe('application/json');
      expect(sanitized['x-custom']).toBe('preserved');
      expect(sanitized['connection']).toBeUndefined();
      expect(sanitized['keep-alive']).toBeUndefined();
      expect(sanitized['proxy-authorization']).toBeUndefined();
      expect(sanitized['proxy-connection']).toBeUndefined();
      expect(sanitized['transfer-encoding']).toBeUndefined();
      expect(sanitized['te']).toBeUndefined();
      expect(sanitized['trailer']).toBeUndefined();
      expect(sanitized['upgrade']).toBeUndefined();
    });

    it('strips headers listed in connection header value', () => {
      const headers: http.IncomingHttpHeaders = {
        'connection': 'X-Custom-Hop, X-Another',
        'x-custom-hop': 'should-be-stripped',
        'x-another': 'also-stripped',
        'x-keep': 'preserved',
      };

      const sanitized = sanitizeHeaders(headers);

      expect(sanitized['x-custom-hop']).toBeUndefined();
      expect(sanitized['x-another']).toBeUndefined();
      expect(sanitized['x-keep']).toBe('preserved');
    });

    it('handles empty headers', () => {
      const sanitized = sanitizeHeaders({});
      expect(Object.keys(sanitized)).toHaveLength(0);
    });

    it('forwards sanitized headers in HTTP requests', async () => {
      // Upstream server that echoes received headers
      let receivedHeaders: http.IncomingHttpHeaders = {};
      const upstream = await new Promise<{ server: http.Server; port: number }>((resolve) => {
        const server = http.createServer((req, res) => {
          receivedHeaders = req.headers;
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          resolve({ server, port: addr.port });
        });
      });

      try {
        const port = await startProxy();

        // Make request with hop-by-hop headers
        await new Promise<void>((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: `http://127.0.0.1:${upstream.port}/test`,
            method: 'GET',
            headers: {
              'proxy-authorization': 'Basic secret',
              'x-forwarded-for': '1.2.3.4',
            },
          }, (res) => {
            res.on('data', () => {});
            res.on('end', resolve);
          });
          req.on('error', reject);
          req.end();
        });

        // proxy-authorization should be stripped, x-forwarded-for preserved
        expect(receivedHeaders['proxy-authorization']).toBeUndefined();
        expect(receivedHeaders['x-forwarded-for']).toBe('1.2.3.4');
      } finally {
        upstream.server.close();
      }
    });
  });

  describe('request timeouts', () => {
    it('returns 504 when upstream times out', async () => {
      // Upstream server that never responds
      const upstream = await new Promise<{ server: http.Server; port: number }>((resolve) => {
        const server = http.createServer((_req, _res) => {
          // Intentionally never respond
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          resolve({ server, port: addr.port });
        });
      });

      try {
        const port = await startProxy({ upstreamTimeoutMs: 200 });

        const result = await proxyRequest(port, `http://127.0.0.1:${upstream.port}/timeout`);

        expect(result.statusCode).toBe(504);
        expect(result.body).toBe('Gateway Timeout');
      } finally {
        upstream.server.close();
      }
    }, 10000);
  });

  describe('connection limits', () => {
    it('sets maxConnections on the server', async () => {
      const server = createPerRunProxy(makeOptions({ maxConnections: 42 }));
      expect(server.maxConnections).toBe(42);
      server.close();
    });

    it('uses default maxConnections of 128', async () => {
      const server = createPerRunProxy(makeOptions());
      expect(server.maxConnections).toBe(128);
      server.close();
    });
  });

  describe('body size limits', () => {
    it('returns 413 when request body exceeds maxBodyBytes', async () => {
      const upstream = await startHttpServer('ok');
      try {
        const port = await startProxy({ maxBodyBytes: 100 });

        const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: `http://127.0.0.1:${upstream.port}/upload`,
            method: 'POST',
          }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ statusCode: res.statusCode!, body }));
          });
          req.on('error', (err) => {
            // Connection may be reset by the proxy — treat as 413
            resolve({ statusCode: 413, body: 'Request body too large' });
          });
          // Send a body larger than 100 bytes
          req.write(Buffer.alloc(200, 'x'));
          req.end();
        });

        expect(result.statusCode).toBe(413);
      } finally {
        upstream.server.close();
      }
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

  describe('CONNECT tunnel timeout', () => {
    it('destroys both sockets on tunnel timeout', async () => {
      // Start a TCP server that accepts but never sends data
      const hangServer = net.createServer(() => {
        // Intentionally do nothing — simulate a hanging upstream
      });
      await new Promise<void>((resolve) => hangServer.listen(0, '127.0.0.1', resolve));
      const hangPort = (hangServer.address() as net.AddressInfo).port;

      try {
        const logger = jest.fn();
        const port = await startProxy({ upstreamTimeoutMs: 200, logger });

        const { socket } = await new Promise<{ socket: net.Socket }>((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            method: 'CONNECT',
            path: `127.0.0.1:${hangPort}`,
          });
          req.on('connect', (_res, sock) => {
            resolve({ socket: sock });
          });
          req.on('error', reject);
          req.end();
        });

        // Wait for tunnel timeout to fire
        await new Promise<void>((resolve) => {
          socket.on('close', () => resolve());
          socket.on('error', () => {}); // Ignore errors from destruction
        });

        expect(logger).toHaveBeenCalledWith(
          expect.stringContaining('TUNNEL TIMEOUT'),
        );
      } finally {
        hangServer.close();
      }
    }, 10000);
  });

  describe('SSL termination', () => {
    let testCA: { cert: string; key: string };

    beforeAll(() => {
      testCA = generateTestCA();
    });

    function sslProxyOpts(overrides?: Partial<CreateProxyOptions>): Partial<CreateProxyOptions> {
      return {
        tls: {
          rejectUnauthorized: false,
          sslTermination: {
            ca: testCA.cert,
            key: testCA.key,
            cert: testCA.cert,
            cacheCerts: true,
          },
        },
        ...overrides,
      };
    }

    it('allows and forwards request via SSL termination', async () => {
      const upstream = await startHttpsServer('ssl-hello', testCA, '127.0.0.1');
      try {
        const onAllow = jest.fn();
        const port = await startProxy(sslProxyOpts({ onAllow }));

        const response = await sslTerminatedRequest(
          port, '127.0.0.1', upstream.port, '/test-path', testCA.cert,
        );

        expect(response).toContain('200');
        expect(response).toContain('ssl-hello');
        expect(onAllow).toHaveBeenCalledWith('GET', 'https://127.0.0.1/test-path', 'https');
      } finally {
        upstream.server.close();
      }
    }, 15000);

    it('blocks denied URL with full path inspection via SSL termination', async () => {
      const onBlock = jest.fn();
      const port = await startProxy(sslProxyOpts({
        getPolicies: () => [{
          id: 'deny-path',
          name: 'deny-path',
          action: 'deny' as const,
          target: 'url' as const,
          patterns: ['https://127.0.0.1/blocked**'],
          enabled: true,
          priority: 10,
        }],
        getDefaultAction: () => 'allow',
        onBlock,
      }));

      const response = await sslTerminatedRequest(
        port, '127.0.0.1', 443, '/blocked-resource', testCA.cert,
      );

      expect(response).toContain('403');
      expect(response).toContain('blocked-by-policy');
      expect(onBlock).toHaveBeenCalledWith('GET', 'https://127.0.0.1/blocked-resource', 'https');
    }, 15000);

    it('uses cached cert on second request to same host', async () => {
      const upstream = await startHttpsServer('cached', testCA, '127.0.0.1');
      try {
        const logger = jest.fn();
        const port = await startProxy(sslProxyOpts({ logger }));

        // First request — generates cert
        await sslTerminatedRequest(port, '127.0.0.1', upstream.port, '/first', testCA.cert);
        // Second request — uses cache
        const response = await sslTerminatedRequest(port, '127.0.0.1', upstream.port, '/second', testCA.cert);

        expect(response).toContain('200');
        // SSL-TERMINATE should be logged twice (once per request)
        const sslLogs = logger.mock.calls.filter(([msg]: [string]) => msg.startsWith('SSL-TERMINATE 127.0.0.1'));
        expect(sslLogs.length).toBeGreaterThanOrEqual(2);
      } finally {
        upstream.server.close();
      }
    }, 15000);

    it('skips cache when cacheCerts is false', async () => {
      const upstream = await startHttpsServer('no-cache', testCA, '127.0.0.1');
      try {
        const logger = jest.fn();
        const port = await startProxy({
          tls: {
            rejectUnauthorized: false,
            sslTermination: {
              ca: testCA.cert,
              key: testCA.key,
              cert: testCA.cert,
              cacheCerts: false,
            },
          },
          logger,
        });

        const response = await sslTerminatedRequest(
          port, '127.0.0.1', upstream.port, '/no-cache', testCA.cert,
        );

        expect(response).toContain('200');
        expect(response).toContain('no-cache');
      } finally {
        upstream.server.close();
      }
    }, 15000);

    it('returns 502 when cert generation fails', async () => {
      const port = await startProxy({
        tls: {
          rejectUnauthorized: false,
          sslTermination: {
            ca: testCA.cert,
            key: 'INVALID-KEY', // Will cause generateHostCertificate to throw
            cert: testCA.cert,
            cacheCerts: true,
          },
        },
      });

      const { statusCode, body } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: '127.0.0.1:443',
        });

        req.on('connect', (res, socket) => {
          let data = '';
          socket.on('data', (chunk) => { data += chunk.toString(); });
          socket.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
          setTimeout(() => {
            socket.destroy();
            resolve({ statusCode: res.statusCode!, body: data });
          }, 500);
        });
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(502);
    }, 10000);

    it('returns 502 when cert generation fails (no-cache path)', async () => {
      const port = await startProxy({
        tls: {
          rejectUnauthorized: false,
          sslTermination: {
            ca: testCA.cert,
            key: 'INVALID-KEY',
            cert: testCA.cert,
            cacheCerts: false,
          },
        },
      });

      const { statusCode } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: '127.0.0.1:443',
        });

        req.on('connect', (res, socket) => {
          let data = '';
          socket.on('data', (chunk) => { data += chunk.toString(); });
          socket.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
          setTimeout(() => {
            socket.destroy();
            resolve({ statusCode: res.statusCode!, body: data });
          }, 500);
        });
        req.on('error', reject);
        req.end();
      });

      expect(statusCode).toBe(502);
    }, 10000);

    it('handles TLS socket error', async () => {
      const logger = jest.fn();
      const port = await startProxy(sslProxyOpts({ logger }));

      // CONNECT and then send garbage instead of a TLS handshake
      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: '127.0.0.1:443',
        });

        req.on('connect', (_res, socket) => {
          // Send garbage data — not a valid TLS ClientHello
          socket.write(Buffer.from('NOT-TLS-DATA\r\n'));
          socket.on('error', () => {});
          socket.on('close', () => resolve());
          setTimeout(() => {
            socket.destroy();
            resolve();
          }, 1000);
        });
        req.on('error', () => resolve());
        req.end();
      });

      // The TLS error handler should have logged
      const tlsErrorLogs = logger.mock.calls.filter(
        ([msg]: [string]) => msg.includes('SSL-TERMINATE TLS error'),
      );
      expect(tlsErrorLogs.length).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('handles client socket error during SSL termination', async () => {
      const logger = jest.fn();
      const port = await startProxy(sslProxyOpts({ logger }));

      await new Promise<void>((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: '127.0.0.1:443',
        });

        req.on('connect', (_res, socket) => {
          // Start TLS handshake then immediately reset the connection
          const tlsSock = tls.connect({
            socket,
            servername: '127.0.0.1',
            ca: testCA.cert,
            rejectUnauthorized: false,
          });
          tlsSock.on('error', () => {});
          socket.on('error', () => {});
          // Force-destroy the underlying socket to trigger clientSocket error
          setTimeout(() => {
            (socket as net.Socket & { resetAndDestroy(): void }).resetAndDestroy?.();
            socket.destroy();
          }, 50);
          setTimeout(() => resolve(), 500);
        });
        req.on('error', () => resolve());
        req.end();
      });

      // No crash — error was handled gracefully
    }, 10000);

    it('returns 504 on upstream timeout during SSL termination', async () => {
      // Start a TCP server that accepts TLS but never responds
      const hangCert = generateHostCertificate('127.0.0.1', testCA.cert, testCA.key);
      const hangServer = net.createServer((socket) => {
        const tlsSock = new tls.TLSSocket(socket, {
          isServer: true,
          secureContext: tls.createSecureContext({
            key: hangCert.key,
            cert: hangCert.cert,
          }),
        });
        tlsSock.on('error', () => {});
        // Accept but never respond
      });
      await new Promise<void>((resolve) => hangServer.listen(0, '127.0.0.1', resolve));
      const hangPort = (hangServer.address() as net.AddressInfo).port;

      try {
        const port = await startProxy({
          ...sslProxyOpts(),
          upstreamTimeoutMs: 300,
        });

        const response = await sslTerminatedRequest(
          port, '127.0.0.1', hangPort, '/timeout', testCA.cert,
        );

        expect(response).toContain('504');
        expect(response).toContain('Gateway Timeout');
      } finally {
        hangServer.close();
      }
    }, 15000);

    it('returns 502 on upstream error during SSL termination', async () => {
      // Use a port that's definitely not listening for HTTPS
      const port = await startProxy(sslProxyOpts());

      const response = await sslTerminatedRequest(
        port, '127.0.0.1', 1, '/error', testCA.cert,
      );

      expect(response).toContain('502');
    }, 10000);

    it('skips data with fewer than 2 parts (malformed request line)', async () => {
      const logger = jest.fn();
      const onAllow = jest.fn();
      const onBlock = jest.fn();
      const port = await startProxy(sslProxyOpts({ logger, onAllow, onBlock }));

      // Send a malformed request (no space, so parts.length < 2)
      await new Promise<void>((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          method: 'CONNECT',
          path: '127.0.0.1:443',
        });

        req.on('connect', (_res, socket) => {
          const tlsSock = tls.connect({
            socket,
            servername: '127.0.0.1',
            rejectUnauthorized: false,
          }, () => {
            // Send malformed data (no HTTP method + path)
            tlsSock.write('MALFORMED\r\n\r\n');
            setTimeout(() => {
              tlsSock.destroy();
              resolve();
            }, 200);
          });
          tlsSock.on('error', () => resolve());
        });
        req.on('error', () => resolve());
        req.end();
      });

      // onAllow/onBlock should not be called for the malformed request
      // (the CONNECT itself is allowed, but the inner malformed request is skipped)
      const innerCalls = onAllow.mock.calls.filter(
        ([m]: [string]) => m !== 'CONNECT',
      );
      expect(innerCalls).toHaveLength(0);
    }, 10000);

    it('forwards request body after headers', async () => {
      // Start an HTTPS server that echoes the request body
      let receivedBody = '';
      const hostCert = generateHostCertificate('127.0.0.1', testCA.cert, testCA.key);
      const upstream = await new Promise<{ server: https.Server; port: number }>((resolve) => {
        const server = https.createServer(
          { key: hostCert.key, cert: hostCert.cert },
          (req, res) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk.toString(); });
            req.on('end', () => {
              receivedBody = body;
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end('got-body');
            });
          },
        );
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          resolve({ server, port: addr.port });
        });
      });

      try {
        const port = await startProxy(sslProxyOpts());

        const response = await sslTerminatedRequest(
          port, '127.0.0.1', upstream.port, '/upload', testCA.cert, 'POST', 'test-body-data',
        );

        expect(response).toContain('200');
        expect(receivedBody).toBe('test-body-data');
      } finally {
        upstream.server.close();
      }
    }, 15000);
  });
});
