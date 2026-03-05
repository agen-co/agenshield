import * as http from 'node:http';
import * as net from 'node:net';
import { ProxyPool } from '../pool';
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
});
