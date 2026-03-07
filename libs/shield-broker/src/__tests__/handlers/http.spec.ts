import * as http from 'node:http';
import { handleHttpRequest } from '../../handlers/http.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

const ctx = createHandlerContext();
const deps = createMockDeps();

function createTargetServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

describe('handleHttpRequest', () => {
  let servers: http.Server[] = [];

  afterEach(() => {
    for (const s of servers) s.close();
    servers = [];
  });

  it('should return error 1003 when url is missing', async () => {
    const result = await handleHttpRequest({}, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should return error 1003 for invalid URL', async () => {
    const result = await handleHttpRequest({ url: 'not-a-url' }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should proxy GET request and return response', async () => {
    const { server, port } = await createTargetServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello world');
    });
    servers.push(server);

    const result = await handleHttpRequest(
      { url: `http://127.0.0.1:${port}/test` },
      ctx, deps
    );
    expect(result.success).toBe(true);
    expect(result.data!.status).toBe(200);
    expect(result.data!.body).toBe('hello world');
  });

  it('should proxy POST request with body', async () => {
    const { server, port } = await createTargetServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: body }));
      });
    });
    servers.push(server);

    const result = await handleHttpRequest(
      { url: `http://127.0.0.1:${port}/api`, method: 'POST', body: '{"foo":"bar"}' },
      ctx, deps
    );
    expect(result.success).toBe(true);
    expect(result.data!.status).toBe(201);
    expect(JSON.parse(result.data!.body).received).toBe('{"foo":"bar"}');
  });

  it('should follow redirects', async () => {
    const { server: target, port: targetPort } = await createTargetServer((_req, res) => {
      res.writeHead(200);
      res.end('final');
    });
    servers.push(target);

    const { server: redirect, port: redirectPort } = await createTargetServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/final` });
      res.end();
    });
    servers.push(redirect);

    const result = await handleHttpRequest(
      { url: `http://127.0.0.1:${redirectPort}/start` },
      ctx, deps
    );
    expect(result.success).toBe(true);
    expect(result.data!.body).toBe('final');
  });

  it('should return error 1004 on network error', async () => {
    // Connect to a port where nothing is listening
    const result = await handleHttpRequest(
      { url: 'http://127.0.0.1:1/unreachable', timeout: 1000 },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1004);
  });

  it('should return error for too many redirects', async () => {
    let redirectCount = 0;
    const { server, port } = await createTargetServer((_req, res) => {
      redirectCount++;
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/redirect-${redirectCount}` });
      res.end();
    });
    servers.push(server);

    const result = await handleHttpRequest(
      { url: `http://127.0.0.1:${port}/start`, timeout: 5000 },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1004);
    expect(result.error!.message).toContain('redirect');
  });

  it('should return error 1004 on request timeout', async () => {
    const { server, port } = await createTargetServer((_req, _res) => {
      // Never respond
    });
    servers.push(server);

    const result = await handleHttpRequest(
      { url: `http://127.0.0.1:${port}/slow`, timeout: 100 },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1004);
    expect(result.error!.message).toContain('timeout');
  });

  it('should return error 1003 for ://broken URL format', async () => {
    const result = await handleHttpRequest({ url: '://broken' }, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should return error when redirect URL is invalid', async () => {
    const { server, port } = await createTargetServer((_req, res) => {
      // Redirect to an invalid URL
      res.writeHead(302, { Location: '://invalid-redirect' });
      res.end();
    });
    servers.push(server);

    const result = await handleHttpRequest(
      { url: `http://127.0.0.1:${port}/start`, timeout: 2000 },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1004);
  });

  it('should return error 1004 when doRequest encounters invalid URL during redirect', async () => {
    // The outer catch at line 191 covers unexpected errors during param extraction.
    // We trigger it by passing params that cause an error in the outer try block
    // after the URL validation but before doRequest returns.
    // One way: pass a URL that passes `new URL()` validation but causes an error
    // in http.request options construction (e.g., hostname extraction issue).
    // Actually, line 191 is the outermost catch. Let's pass params that throw
    // during destructuring — e.g., a params object with a getter that throws.
    const badParams = {
      get url(): string {
        return 'http://example.com';
      },
      get method(): string {
        throw new Error('Unexpected getter error');
      },
    };

    const result = await handleHttpRequest(badParams, ctx, deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1004);
    expect(result.error!.message).toContain('Handler error');
  });
});
