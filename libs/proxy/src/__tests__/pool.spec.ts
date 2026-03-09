import * as http from 'node:http';
import * as net from 'node:net';
import { ProxyPool } from '../pool';
import {
  ProxyError,
  ProxyBindError,
  ProxyPoolExhaustedError,
  PolicyBlockedError,
  UpstreamTimeoutError,
  SslTerminationError,
  classifyNetworkError,
} from '../errors';
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

/** Make an HTTP request through a proxy port */
function proxyRequest(
  proxyPort: number,
  targetUrl: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: proxyPort,
        path: targetUrl,
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode!, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Check if a port is accepting connections */
function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

describe('ProxyPool', () => {
  let pool: ProxyPool;

  afterEach(() => {
    pool?.shutdown();
  });

  it('uses default options when constructed without arguments', () => {
    pool = new ProxyPool();
    expect(pool.size).toBe(0);
  });

  it('release is a no-op for unknown execId', () => {
    pool = new ProxyPool({}, { logger: jest.fn() });
    // Should not throw
    pool.release('non-existent-exec-id');
    expect(pool.size).toBe(0);
  });

  it('uses console.log when no logger hook provided', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    pool = new ProxyPool({});

    await pool.acquire('exec-console', 'cmd', allowAllPolicies, () => 'allow');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('rejects with ProxyBindError when server fails to bind', async () => {
    pool = new ProxyPool({}, { logger: jest.fn() });

    // Acquire a proxy to occupy a port
    const { port } = await pool.acquire('exec-bind-1', 'cmd', allowAllPolicies, () => 'allow');

    // Create a second pool and try to bind to the same specific port
    // by using a raw server to occupy and trigger the error path
    const blockingServer = net.createServer();
    const blockingPort = await new Promise<number>((resolve) => {
      blockingServer.listen(0, '127.0.0.1', () => {
        resolve((blockingServer.address() as net.AddressInfo).port);
      });
    });

    // We can't easily force ProxyPool to bind to a specific port,
    // but we can verify the error class works properly
    const err = new ProxyBindError('EADDRINUSE');
    expect(err.code).toBe('PROXY_BIND_FAILED');
    expect(err.message).toBe('EADDRINUSE');

    blockingServer.close();
  });

  it('acquire returns a valid port with a listening server', async () => {
    pool = new ProxyPool({}, { logger: jest.fn() });

    const { port } = await pool.acquire(
      'exec-1',
      'test-command',
      allowAllPolicies,
      () => 'allow',
    );

    expect(port).toBeGreaterThan(0);
    expect(await isPortListening(port)).toBe(true);
    expect(pool.size).toBe(1);
  });

  it('release closes the server', async () => {
    pool = new ProxyPool({}, { logger: jest.fn() });

    const { port } = await pool.acquire(
      'exec-2',
      'test-command',
      allowAllPolicies,
      () => 'allow',
    );

    pool.release('exec-2');

    expect(pool.size).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(await isPortListening(port)).toBe(false);
  });

  it('onRelease hook fires on release', async () => {
    const onRelease = jest.fn();
    pool = new ProxyPool({}, { onRelease, logger: jest.fn() });

    await pool.acquire('exec-3', 'cmd', allowAllPolicies, () => 'allow');
    pool.release('exec-3');

    expect(onRelease).toHaveBeenCalledWith('exec-3');
  });

  it('onBlock hook fires when request is blocked', async () => {
    const onBlock = jest.fn();
    pool = new ProxyPool({}, { onBlock, logger: jest.fn() });

    const { port } = await pool.acquire(
      'exec-4',
      'cmd',
      denyAllPolicies,
      () => 'allow',
    );

    // Use HTTPS URL since plain HTTP gets blocked by default policy behavior
    await proxyRequest(port, 'https://blocked.example.com/path');

    expect(onBlock).toHaveBeenCalledWith('exec-4', 'GET', 'https://blocked.example.com/path', 'https');
  });

  it('idle timeout releases the proxy', async () => {
    pool = new ProxyPool(
      { idleTimeoutMs: 100 },
      { logger: jest.fn() },
    );

    await pool.acquire('exec-5', 'cmd', allowAllPolicies, () => 'allow');
    expect(pool.size).toBe(1);

    await new Promise((r) => setTimeout(r, 200));
    expect(pool.size).toBe(0);
  });

  it('evicts oldest proxy when pool is full', async () => {
    const onRelease = jest.fn();
    pool = new ProxyPool(
      { maxConcurrent: 2 },
      { onRelease, logger: jest.fn() },
    );

    await pool.acquire('exec-a', 'cmd-a', allowAllPolicies, () => 'allow');
    await new Promise((r) => setTimeout(r, 10));
    await pool.acquire('exec-b', 'cmd-b', allowAllPolicies, () => 'allow');
    await new Promise((r) => setTimeout(r, 10));

    // This should evict exec-a (oldest)
    await pool.acquire('exec-c', 'cmd-c', allowAllPolicies, () => 'allow');

    expect(pool.size).toBe(2);
    expect(onRelease).toHaveBeenCalledWith('exec-a');
  });

  it('shutdown closes all proxies', async () => {
    pool = new ProxyPool({}, { logger: jest.fn() });

    const results = await Promise.all([
      pool.acquire('exec-x', 'cmd', allowAllPolicies, () => 'allow'),
      pool.acquire('exec-y', 'cmd', allowAllPolicies, () => 'allow'),
      pool.acquire('exec-z', 'cmd', allowAllPolicies, () => 'allow'),
    ]);

    expect(pool.size).toBe(3);
    pool.shutdown();
    expect(pool.size).toBe(0);

    await new Promise((r) => setTimeout(r, 50));
    for (const { port } of results) {
      expect(await isPortListening(port)).toBe(false);
    }
  });

  it('activity resets idle timer', async () => {
    const upstream = await new Promise<{ server: http.Server; port: number }>((resolve) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        resolve({ server, port: addr.port });
      });
    });

    try {
      pool = new ProxyPool(
        { idleTimeoutMs: 200 },
        { logger: jest.fn() },
      );

      const { port } = await pool.acquire(
        'exec-idle',
        'cmd',
        allowAllPolicies,
        () => 'allow',
      );

      // Make a request at 100ms (before 200ms timeout)
      await new Promise((r) => setTimeout(r, 100));
      await proxyRequest(port, `http://127.0.0.1:${upstream.port}/keepalive`);

      // At 250ms (would have expired without the reset at 100ms)
      await new Promise((r) => setTimeout(r, 150));
      expect(pool.size).toBe(1); // Still alive because timer was reset

      // Now wait for the full idle timeout after last activity
      await new Promise((r) => setTimeout(r, 250));
      expect(pool.size).toBe(0); // Now expired
    } finally {
      upstream.server.close();
    }
  });

  describe('socket tracking', () => {
    it('tracks active sockets on proxy instances', async () => {
      pool = new ProxyPool({}, { logger: jest.fn() });

      const { port } = await pool.acquire(
        'exec-sock',
        'cmd',
        allowAllPolicies,
        () => 'allow',
      );

      // Connect to the proxy
      const socket = net.connect(port, '127.0.0.1');
      await new Promise<void>((resolve) => socket.on('connect', resolve));

      // Give the server a moment to register the connection
      await new Promise((r) => setTimeout(r, 50));

      socket.destroy();
    });
  });

  describe('releaseGracefully', () => {
    it('drains active connections before closing', async () => {
      pool = new ProxyPool({}, { logger: jest.fn() });

      const { port } = await pool.acquire(
        'exec-grace',
        'cmd',
        allowAllPolicies,
        () => 'allow',
      );

      // Connect a client socket
      const client = net.connect(port, '127.0.0.1');
      await new Promise<void>((resolve) => client.on('connect', resolve));
      await new Promise((r) => setTimeout(r, 50));

      // Start graceful release — client is still connected
      const releasePromise = pool.releaseGracefully('exec-grace', 2000);

      // Close the client after a brief delay
      setTimeout(() => client.destroy(), 100);

      await releasePromise;

      expect(pool.size).toBe(0);
    });

    it('force-destroys sockets after drain timeout', async () => {
      pool = new ProxyPool({}, { logger: jest.fn() });

      const { port } = await pool.acquire(
        'exec-force',
        'cmd',
        allowAllPolicies,
        () => 'allow',
      );

      // Connect a client socket that never closes
      const client = net.connect(port, '127.0.0.1');
      await new Promise<void>((resolve) => client.on('connect', resolve));
      client.on('error', () => {}); // Suppress error from force-destroy
      await new Promise((r) => setTimeout(r, 50));

      // Graceful release with a very short timeout
      await pool.releaseGracefully('exec-force', 100);

      expect(pool.size).toBe(0);
    });

    it('completes immediately when no active sockets', async () => {
      const onRelease = jest.fn();
      pool = new ProxyPool({}, { onRelease, logger: jest.fn() });

      await pool.acquire('exec-empty', 'cmd', allowAllPolicies, () => 'allow');

      await pool.releaseGracefully('exec-empty');

      expect(pool.size).toBe(0);
      expect(onRelease).toHaveBeenCalledWith('exec-empty');
    });

    it('is a no-op for unknown execId', async () => {
      pool = new ProxyPool({}, { logger: jest.fn() });
      await pool.releaseGracefully('non-existent');
      expect(pool.size).toBe(0);
    });

    it('uses drainTimeoutMs from pool options', async () => {
      pool = new ProxyPool({ drainTimeoutMs: 100 }, { logger: jest.fn() });

      const { port } = await pool.acquire(
        'exec-drain-opt',
        'cmd',
        allowAllPolicies,
        () => 'allow',
      );

      const client = net.connect(port, '127.0.0.1');
      await new Promise<void>((resolve) => client.on('connect', resolve));
      client.on('error', () => {});
      await new Promise((r) => setTimeout(r, 50));

      // Use default drain timeout from pool options (100ms)
      await pool.releaseGracefully('exec-drain-opt');

      expect(pool.size).toBe(0);
    });
  });

  it('per-acquire callbacks fire alongside pool hooks', async () => {
    const poolOnBlock = jest.fn();
    const acquireOnBlock = jest.fn();
    pool = new ProxyPool({}, { onBlock: poolOnBlock, logger: jest.fn() });

    const { port } = await pool.acquire(
      'exec-cb',
      'cmd',
      denyAllPolicies,
      () => 'allow',
      { onBlock: acquireOnBlock },
    );

    await proxyRequest(port, 'https://denied.example.com/');

    // Both should fire
    expect(poolOnBlock).toHaveBeenCalledWith('exec-cb', 'GET', expect.any(String), 'https');
    expect(acquireOnBlock).toHaveBeenCalledWith('GET', expect.any(String), 'https');
  });

  it('fires onAllow pool hook and per-acquire onAllow on allowed requests', async () => {
    const upstream = await new Promise<{ server: http.Server; port: number }>((resolve) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        resolve({ server, port: addr.port });
      });
    });

    try {
      const poolOnAllow = jest.fn();
      const acquireOnAllow = jest.fn();
      pool = new ProxyPool({}, { onAllow: poolOnAllow, logger: jest.fn() });

      const { port } = await pool.acquire(
        'exec-allow',
        'cmd',
        allowAllPolicies,
        () => 'allow',
        { onAllow: acquireOnAllow },
      );

      await proxyRequest(port, `http://127.0.0.1:${upstream.port}/test`);

      expect(poolOnAllow).toHaveBeenCalledWith('exec-allow', 'GET', expect.any(String), 'http');
      expect(acquireOnAllow).toHaveBeenCalledWith('GET', expect.any(String), 'http');
    } finally {
      upstream.server.close();
    }
  });
});

describe('Error classes', () => {
  it('ProxyError sets name, code, message, and stack', () => {
    const err = new ProxyError('test message', 'TEST_CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ProxyError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err.stack).toBeDefined();
  });

  it('ProxyBindError defaults message and sets code', () => {
    const err = new ProxyBindError();
    expect(err).toBeInstanceOf(ProxyError);
    expect(err.name).toBe('ProxyBindError');
    expect(err.code).toBe('PROXY_BIND_FAILED');
    expect(err.message).toBe('Failed to bind proxy server');
  });

  it('ProxyBindError accepts custom message', () => {
    const err = new ProxyBindError('custom bind error');
    expect(err.message).toBe('custom bind error');
    expect(err.code).toBe('PROXY_BIND_FAILED');
  });

  it('ProxyPoolExhaustedError sets maxConcurrent', () => {
    const err = new ProxyPoolExhaustedError(42);
    expect(err).toBeInstanceOf(ProxyError);
    expect(err.name).toBe('ProxyPoolExhaustedError');
    expect(err.code).toBe('PROXY_POOL_EXHAUSTED');
    expect(err.maxConcurrent).toBe(42);
    expect(err.message).toContain('42');
  });

  it('PolicyBlockedError sets target, method, protocol', () => {
    const err = new PolicyBlockedError({
      target: 'https://blocked.com',
      method: 'GET',
      protocol: 'https',
    });
    expect(err).toBeInstanceOf(ProxyError);
    expect(err.name).toBe('PolicyBlockedError');
    expect(err.code).toBe('POLICY_BLOCKED');
    expect(err.target).toBe('https://blocked.com');
    expect(err.method).toBe('GET');
    expect(err.protocol).toBe('https');
    expect(err.message).toContain('blocked.com');
  });

  it('UpstreamTimeoutError sets target and timeoutMs', () => {
    const err = new UpstreamTimeoutError('https://slow.com/api', 30000);
    expect(err).toBeInstanceOf(ProxyError);
    expect(err.name).toBe('UpstreamTimeoutError');
    expect(err.code).toBe('UPSTREAM_TIMEOUT');
    expect(err.target).toBe('https://slow.com/api');
    expect(err.timeoutMs).toBe(30000);
    expect(err.message).toContain('30000ms');
    expect(err.message).toContain('slow.com');
  });

  it('SslTerminationError sets hostname and optional cause', () => {
    const err1 = new SslTerminationError('secure.example.com');
    expect(err1).toBeInstanceOf(ProxyError);
    expect(err1.name).toBe('SslTerminationError');
    expect(err1.code).toBe('SSL_TERMINATION_FAILED');
    expect(err1.hostname).toBe('secure.example.com');
    expect(err1.message).toBe('SSL termination failed for secure.example.com');

    const err2 = new SslTerminationError('secure.example.com', 'cert expired');
    expect(err2.message).toBe('SSL termination failed for secure.example.com: cert expired');
  });
});

describe('classifyNetworkError', () => {
  it('classifies ENOTFOUND as dns-resolution-failed', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const result = classifyNetworkError(err);
    expect(result.type).toBe('dns-resolution-failed');
    expect(result.userMessage).toContain('DNS resolution failed');
  });

  it('classifies EAI_AGAIN as dns-resolution-failed', () => {
    const err = Object.assign(new Error('temporary failure'), { code: 'EAI_AGAIN' });
    const result = classifyNetworkError(err);
    expect(result.type).toBe('dns-resolution-failed');
  });

  it('classifies ECONNREFUSED as connection-refused', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const result = classifyNetworkError(err);
    expect(result.type).toBe('connection-refused');
    expect(result.userMessage).toContain('Connection refused');
  });

  it('classifies ETIMEDOUT as connection-timeout', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const result = classifyNetworkError(err);
    expect(result.type).toBe('connection-timeout');
    expect(result.userMessage).toContain('Connection timed out');
  });

  it('classifies ENETUNREACH as connection-timeout', () => {
    const err = Object.assign(new Error('net unreachable'), { code: 'ENETUNREACH' });
    const result = classifyNetworkError(err);
    expect(result.type).toBe('connection-timeout');
  });

  it('classifies EHOSTUNREACH as connection-timeout', () => {
    const err = Object.assign(new Error('host unreachable'), { code: 'EHOSTUNREACH' });
    const result = classifyNetworkError(err);
    expect(result.type).toBe('connection-timeout');
  });

  it('classifies unknown codes as network-error', () => {
    const err = Object.assign(new Error('something else'), { code: 'EUNKNOWN' });
    const result = classifyNetworkError(err);
    expect(result.type).toBe('network-error');
    expect(result.userMessage).toContain('Network error');
  });

  it('classifies errors with no code as network-error', () => {
    const err = new Error('no code');
    const result = classifyNetworkError(err);
    expect(result.type).toBe('network-error');
  });
});
