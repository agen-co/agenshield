/**
 * Proxy — Performance Test Suite
 *
 * Measures throughput and event loop impact for:
 * - Proxy server lifecycle (create/listen/close)
 * - ProxyPool acquire/release throughput
 * - Pool eviction under pressure
 * - HTTP forwarding throughput
 * - CONNECT tunnel throughput
 * - Policy evaluation overhead
 * - Event loop blocking audit
 * - Bulk concurrent proxy management
 */

import * as http from 'node:http';
import * as net from 'node:net';
import { createPerRunProxy } from '../server';
import { ProxyPool } from '../pool';
import { classifyNetworkError } from '../errors';
import type { CreateProxyOptions } from '../types';
import type { PolicyConfig } from '@agenshield/ipc';
import { checkUrlPolicy } from '@agenshield/policies';
import { perf } from '../../../../tools/perf-metric';

jest.setTimeout(120_000);

// ── Helpers ──────────────────────────────────────────────────────────────────

function opsPerSec(count: number, elapsedMs: number): number {
  return Math.round((count / elapsedMs) * 1000);
}

async function measureEventLoopLag(fn: () => void | Promise<void>) {
  const { monitorEventLoopDelay } = await import('node:perf_hooks');
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  const start = performance.now();
  await fn();
  const elapsed = performance.now() - start;
  h.disable();
  return {
    elapsed,
    maxLagMs: h.max / 1e6,
    p99LagMs: h.percentile(99) / 1e6,
    meanLagMs: h.mean / 1e6,
  };
}

function measureEventLoopBlock(syncFn: () => void): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => resolve(performance.now() - start), 0);
    syncFn();
  });
}

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

function complexPolicies(count: number): PolicyConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `policy-${i}`,
    name: `Policy ${i}`,
    action: (i % 2 === 0 ? 'allow' : 'deny') as 'allow' | 'deny',
    target: 'url' as const,
    patterns: [`https://example-${i}.com/*`, `https://*.service-${i}.internal/*`],
    enabled: true,
    priority: i,
  }));
}

function makeOptions(overrides?: Partial<CreateProxyOptions>): CreateProxyOptions {
  return {
    getPolicies: allowAllPolicies,
    getDefaultAction: () => 'allow',
    onActivity: () => {},
    logger: () => {},
    onBlock: () => {},
    onAllow: () => {},
    ...overrides,
  };
}

/** Start a local HTTP echo server on port 0 */
function startEchoHttpServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`echo:${req.method}:${req.url}`);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

/** Start a local TCP echo server on port 0 */
function startTcpEchoServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('data', (data) => socket.write(data));
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

/** Establish a CONNECT tunnel through the proxy */
function connectTunnel(
  proxyPort: number,
  target: string,
): Promise<{ socket: net.Socket; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: target,
    });
    req.on('connect', (res, sock) => {
      resolve({ socket: sock, statusCode: res.statusCode! });
    });
    req.on('error', reject);
    req.end();
  });
}

function startProxy(opts?: Partial<CreateProxyOptions>): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = createPerRunProxy(makeOptions(opts));
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('Proxy — Performance', () => {
  beforeAll(() => jest.useRealTimers());

  // ── 1. Proxy server lifecycle ────────────────────────────────────────────

  describe('1. Proxy server lifecycle', () => {
    it('create + listen + close cycle: > 100 ops/sec', async () => {
      const count = 200;
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        const { server, port } = await startProxy();
        server.close();
        await new Promise<void>((r) => server.on('close', r));
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(count, elapsed);
      perf('proxy', 'lifecycle.createListenClose', ops, '>', 100, 'ops/sec');
    });

    it('create without listen (sync): > 5000 ops/sec', () => {
      const count = 1000;
      const servers: http.Server[] = [];
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        servers.push(createPerRunProxy(makeOptions()));
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(count, elapsed);
      perf('proxy', 'lifecycle.createNoListen', ops, '>', 5000, 'ops/sec');
    });
  });

  // ── 2. Pool acquire/release throughput ───────────────────────────────────

  describe('2. Pool acquire/release throughput', () => {
    it('sequential acquire/release 100 proxies: > 50 ops/sec', async () => {
      const pool = new ProxyPool({}, { logger: () => {} });
      const count = 100;
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        await pool.acquire(`s2-seq-${i}`, `cmd-${i}`, allowAllPolicies, () => 'allow');
        pool.release(`s2-seq-${i}`);
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(count, elapsed);
      perf('proxy', 'pool.sequentialAcquireRelease', ops, '>', 50, 'ops/sec');

      pool.shutdown();
    });

    it('parallel acquire 20 + release all: acquire < 500ms, release < 100ms', async () => {
      const pool = new ProxyPool({}, { logger: () => {} });
      const count = 20;

      const acquireStart = performance.now();
      await Promise.all(
        Array.from({ length: count }, (_, i) =>
          pool.acquire(`s2-par-${i}`, `cmd-${i}`, allowAllPolicies, () => 'allow'),
        ),
      );
      const acquireElapsed = performance.now() - acquireStart;
      perf('proxy', 'pool.parallelAcquire', acquireElapsed, '<', 500, 'ms');

      const releaseStart = performance.now();
      for (let i = 0; i < count; i++) {
        pool.release(`s2-par-${i}`);
      }
      const releaseElapsed = performance.now() - releaseStart;
      perf('proxy', 'pool.release', releaseElapsed, '<', 100, 'ms');

      pool.shutdown();
    });
  });

  // ── 3. Pool eviction under pressure ──────────────────────────────────────

  describe('3. Pool eviction under pressure', () => {
    it('eviction at maxConcurrent=10, acquire 15: < 2000ms, verify FIFO eviction', async () => {
      const evicted: string[] = [];
      const pool = new ProxyPool(
        { maxConcurrent: 10 },
        { onRelease: (id) => evicted.push(id), logger: () => {} },
      );

      const start = performance.now();
      for (let i = 0; i < 15; i++) {
        await pool.acquire(`s3-evict-${i}`, `cmd-${i}`, allowAllPolicies, () => 'allow');
        // Small delay to ensure lastActivity ordering
        await new Promise((r) => setTimeout(r, 2));
      }
      const elapsed = performance.now() - start;

      perf('proxy', 'pool.eviction15', elapsed, '<', 2000, 'ms');
      expect(evicted.length).toBe(5);
      // First 5 should be evicted (FIFO by oldest lastActivity)
      for (let i = 0; i < 5; i++) {
        expect(evicted[i]).toBe(`s3-evict-${i}`);
      }

      pool.shutdown();
    });

    it('rapid eviction cycling 50 into maxConcurrent=5: < 5000ms, verify 45 evictions', async () => {
      const evicted: string[] = [];
      const pool = new ProxyPool(
        { maxConcurrent: 5 },
        { onRelease: (id) => evicted.push(id), logger: () => {} },
      );

      const start = performance.now();
      for (let i = 0; i < 50; i++) {
        await pool.acquire(`s3-cycle-${i}`, `cmd-${i}`, allowAllPolicies, () => 'allow');
        await new Promise((r) => setTimeout(r, 1));
      }
      const elapsed = performance.now() - start;

      perf('proxy', 'pool.rapidEviction50', elapsed, '<', 5000, 'ms');
      expect(evicted.length).toBe(45);

      pool.shutdown();
    });
  });

  // ── 4. HTTP forwarding throughput ────────────────────────────────────────

  describe('4. HTTP forwarding throughput', () => {
    let echoServer: http.Server;
    let echoPort: number;
    let proxyServer: http.Server;
    let proxyPort: number;

    beforeAll(async () => {
      ({ server: echoServer, port: echoPort } = await startEchoHttpServer());
      ({ server: proxyServer, port: proxyPort } = await startProxy());
    });

    afterAll(() => {
      proxyServer.close();
      echoServer.close();
    });

    it('sequential 500 HTTP requests: > 200 req/sec', async () => {
      const count = 500;
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        const result = await proxyRequest(proxyPort, `http://127.0.0.1:${echoPort}/test-${i}`);
        expect(result.statusCode).toBe(200);
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(count, elapsed);
      perf('proxy', 'http.sequential500', ops, '>', 200, 'ops/sec');
    });

    it('parallel batches (10x50): < 5000ms', async () => {
      const batchSize = 50;
      const batches = 10;
      const start = performance.now();

      for (let b = 0; b < batches; b++) {
        await Promise.all(
          Array.from({ length: batchSize }, (_, i) =>
            proxyRequest(proxyPort, `http://127.0.0.1:${echoPort}/batch-${b}-${i}`),
          ),
        );
      }

      const elapsed = performance.now() - start;
      perf('proxy', 'http.parallelBatches', elapsed, '<', 5000, 'ms');
    });

    it('blocked requests (deny policy) 500: > 500 req/sec', async () => {
      const { server: denyProxy, port: denyPort } = await startProxy({
        getPolicies: denyAllPolicies,
        getDefaultAction: () => 'allow',
      });

      try {
        const count = 500;
        const start = performance.now();

        for (let i = 0; i < count; i++) {
          const result = await proxyRequest(denyPort, `http://blocked.example.com/path-${i}`);
          expect(result.statusCode).toBe(403);
        }

        const elapsed = performance.now() - start;
        const ops = opsPerSec(count, elapsed);
        perf('proxy', 'http.blocked500', ops, '>', 500, 'ops/sec');
      } finally {
        denyProxy.close();
      }
    });
  });

  // ── 5. CONNECT tunnel throughput ─────────────────────────────────────────

  describe('5. CONNECT tunnel throughput', () => {
    let tcpServer: net.Server;
    let tcpPort: number;
    let proxyServer: http.Server;
    let proxyPort: number;

    beforeAll(async () => {
      ({ server: tcpServer, port: tcpPort } = await startTcpEchoServer());
      ({ server: proxyServer, port: proxyPort } = await startProxy());
    });

    afterAll(() => {
      proxyServer.close();
      tcpServer.close();
    });

    it('sequential 200 tunnel establishments: > 100 tunnels/sec', async () => {
      const count = 200;
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        const { socket, statusCode } = await connectTunnel(proxyPort, `127.0.0.1:${tcpPort}`);
        expect(statusCode).toBe(200);
        socket.destroy();
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(count, elapsed);
      perf('proxy', 'tunnel.sequential200', ops, '>', 100, 'ops/sec');
    });

    it('tunnel data round-trip 50: < 2000ms', async () => {
      const count = 50;
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        const { socket } = await connectTunnel(proxyPort, `127.0.0.1:${tcpPort}`);
        const response = await new Promise<string>((resolve) => {
          socket.once('data', (data) => resolve(data.toString()));
          socket.write(`ping-${i}`);
        });
        expect(response).toBe(`ping-${i}`);
        socket.destroy();
      }

      const elapsed = performance.now() - start;
      perf('proxy', 'tunnel.roundTrip50', elapsed, '<', 2000, 'ms');
    });

    it('blocked tunnels (deny policy) 200: > 300 tunnels/sec', async () => {
      const { server: denyProxy, port: denyPort } = await startProxy({
        getPolicies: denyAllPolicies,
        getDefaultAction: () => 'allow',
      });

      try {
        const count = 200;
        const start = performance.now();

        for (let i = 0; i < count; i++) {
          const { socket, statusCode } = await connectTunnel(denyPort, `blocked.example.com:443`);
          expect(statusCode).toBe(403);
          socket.destroy();
        }

        const elapsed = performance.now() - start;
        const ops = opsPerSec(count, elapsed);
        perf('proxy', 'tunnel.blocked200', ops, '>', 300, 'ops/sec');
      } finally {
        denyProxy.close();
      }
    });
  });

  // ── 6. Policy evaluation overhead ────────────────────────────────────────

  describe('6. Policy evaluation overhead', () => {
    it('100-policy set: 100 HTTP requests still > 100 req/sec', async () => {
      const { server: echoSrv, port: echoPort } = await startEchoHttpServer();
      const policies = complexPolicies(100);
      const { server: proxy, port: pPort } = await startProxy({
        getPolicies: () => policies,
      });

      const iterations = 100;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        await proxyRequest(pPort, `http://127.0.0.1:${echoPort}/complex-${i}`);
      }
      const elapsed = performance.now() - start;
      const ops = opsPerSec(iterations, elapsed);

      proxy.close();
      echoSrv.close();

      perf('proxy', 'policy.100policyHttp', ops, '>', 100, 'ops/sec');
    });

    it('checkUrlPolicy alone with 100 policies, 10000 evaluations: > 3000 ops/sec', () => {
      const policies = complexPolicies(100);
      const count = 10_000;
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        checkUrlPolicy(policies, `https://unknown-${i % 200}.com/path`, 'allow');
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(count, elapsed);
      perf('proxy', 'policy.checkUrl100', ops, '>', 3_000, 'ops/sec');
    });

    it('checkUrlPolicy alone with 500 policies: > 500 ops/sec', () => {
      const policies = complexPolicies(500);
      const count = 10_000;
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        checkUrlPolicy(policies, `https://unknown-${i % 500}.com/path`, 'deny');
      }

      const elapsed = performance.now() - start;
      const ops = opsPerSec(count, elapsed);
      perf('proxy', 'policy.checkUrl500', ops, '>', 500, 'ops/sec');
    });
  });

  // ── 7. Event loop blocking audit ─────────────────────────────────────────

  describe('7. Event loop blocking audit', () => {
    it('proxy creation: maxLag < 50ms', async () => {
      const lag = await measureEventLoopLag(() => {
        for (let i = 0; i < 100; i++) {
          createPerRunProxy(makeOptions());
        }
      });
      perf('proxy', 'evloop.proxyCreation', lag.maxLagMs, '<', 50, 'ms');
    });

    it('pool acquire: maxLag < 50ms', async () => {
      const pool = new ProxyPool({}, { logger: () => {} });
      const lag = await measureEventLoopLag(async () => {
        for (let i = 0; i < 20; i++) {
          await pool.acquire(`s7-acq-${i}`, `cmd-${i}`, allowAllPolicies, () => 'allow');
        }
      });
      perf('proxy', 'evloop.poolAcquire', lag.maxLagMs, '<', 50, 'ms');
      pool.shutdown();
    });

    it('100 HTTP requests: maxLag < 100ms', async () => {
      const { server: echoSrv, port: echoPort } = await startEchoHttpServer();
      const { server: proxySrv, port: pPort } = await startProxy();

      const lag = await measureEventLoopLag(async () => {
        for (let i = 0; i < 100; i++) {
          await proxyRequest(pPort, `http://127.0.0.1:${echoPort}/lag-${i}`);
        }
      });

      perf('proxy', 'evloop.http100', lag.maxLagMs, '<', 100, 'ms');

      proxySrv.close();
      echoSrv.close();
    });

    it('50 CONNECT tunnels: maxLag < 100ms', async () => {
      const { server: tcpSrv, port: tcpPort } = await startTcpEchoServer();
      const { server: proxySrv, port: pPort } = await startProxy();

      const lag = await measureEventLoopLag(async () => {
        for (let i = 0; i < 50; i++) {
          const { socket } = await connectTunnel(pPort, `127.0.0.1:${tcpPort}`);
          socket.destroy();
        }
      });

      perf('proxy', 'evloop.connect50', lag.maxLagMs, '<', 100, 'ms');

      proxySrv.close();
      tcpSrv.close();
    });

    it('classifyNetworkError 10000 calls: < 50ms', () => {
      const errors = [
        Object.assign(new Error('not found'), { code: 'ENOTFOUND' }),
        Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
        Object.assign(new Error('unknown'), { code: 'UNKNOWN' }),
      ];
      const count = 10_000;
      const start = performance.now();

      for (let i = 0; i < count; i++) {
        classifyNetworkError(errors[i % errors.length]);
      }

      const elapsed = performance.now() - start;
      perf('proxy', 'evloop.classifyNetworkError', elapsed, '<', 50, 'ms');
    });
  });

  // ── 8. Bulk concurrent proxy management ──────────────────────────────────

  describe('8. Bulk concurrent proxy management', () => {
    it('manage 30 concurrent proxies: acquire all < 3000ms', async () => {
      const pool = new ProxyPool({}, { logger: () => {} });
      const count = 30;

      const start = performance.now();
      const ports: number[] = [];
      for (let i = 0; i < count; i++) {
        const { port } = await pool.acquire(`s8-bulk-${i}`, `cmd-${i}`, allowAllPolicies, () => 'allow');
        ports.push(port);
      }
      const elapsed = performance.now() - start;

      perf('proxy', 'bulk.acquire30', elapsed, '<', 3000, 'ms');
      expect(pool.size).toBe(count);

      pool.shutdown();
    });

    it('route traffic through 10 proxies simultaneously (10x20 = 200 requests): < 5000ms', async () => {
      const { server: echoSrv, port: echoPort } = await startEchoHttpServer();
      const pool = new ProxyPool({}, { logger: () => {} });
      const proxyCount = 10;
      const reqsPerProxy = 20;

      const ports: number[] = [];
      for (let i = 0; i < proxyCount; i++) {
        const { port } = await pool.acquire(`s8-route-${i}`, `cmd-${i}`, allowAllPolicies, () => 'allow');
        ports.push(port);
      }

      const start = performance.now();
      await Promise.all(
        ports.flatMap((port, pIdx) =>
          Array.from({ length: reqsPerProxy }, (_, rIdx) =>
            proxyRequest(port, `http://127.0.0.1:${echoPort}/multi-${pIdx}-${rIdx}`),
          ),
        ),
      );
      const elapsed = performance.now() - start;

      perf('proxy', 'bulk.routeTraffic', elapsed, '<', 5000, 'ms');

      pool.shutdown();
      echoSrv.close();
    });

    it('shutdown 30 proxies: < 500ms', async () => {
      const pool = new ProxyPool({}, { logger: () => {} });
      for (let i = 0; i < 30; i++) {
        await pool.acquire(`s8-shut-${i}`, `cmd-${i}`, allowAllPolicies, () => 'allow');
      }
      expect(pool.size).toBe(30);

      const start = performance.now();
      pool.shutdown();
      const elapsed = performance.now() - start;

      perf('proxy', 'bulk.shutdown30', elapsed, '<', 500, 'ms');
      expect(pool.size).toBe(0);
    });
  });
});
