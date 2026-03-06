/**
 * Seatbelt — Performance Test Suite
 *
 * Measures throughput and event loop impact for:
 * - Profile generation (generateProfile)
 * - Profile caching sync/async (getOrCreateProfile / getOrCreateProfileAsync)
 * - buildSandboxConfig throughput
 * - Environment filtering (filterEnvByAllowlist)
 * - Profile cleanup at scale
 * - Concurrent profile generation under load
 * - Event loop blocking audit
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ProfileManager } from '../profile-manager';
import { buildSandboxConfig } from '../config-builder';
import { filterEnvByAllowlist } from '../env-allowlist';
import type { SandboxConfig, PolicyConfig } from '@agenshield/ipc';
import type { SeatbeltDeps, BuildSandboxInput } from '../config-builder';

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

function makeSandboxConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    enabled: true,
    allowedReadPaths: ['/tmp', '/var'],
    allowedWritePaths: ['/tmp'],
    deniedPaths: ['/etc/secrets'],
    networkAllowed: true,
    allowedHosts: ['localhost'],
    allowedPorts: [8080],
    allowedBinaries: ['/usr/bin/curl', '/usr/bin/node'],
    deniedBinaries: ['/usr/bin/rm'],
    envInjection: { HTTP_PROXY: 'http://127.0.0.1:9999' },
    envDeny: ['SECRET_KEY'],
    envAllow: ['MY_VAR'],
    brokerHttpPort: 5201,
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<SeatbeltDeps>): SeatbeltDeps {
  return {
    getPolicies: () => [],
    defaultAction: 'deny',
    agentHome: os.tmpdir(),
    ...overrides,
  };
}

function makePolicies(count: number): PolicyConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `policy-${i}`,
    name: `Policy ${i}`,
    action: (i % 2 === 0 ? 'allow' : 'deny') as 'allow' | 'deny',
    target: 'exec' as const,
    patterns: [`/usr/bin/cmd-${i}`, `/opt/tool-${i}`],
    enabled: true,
    priority: i,
  }));
}

function makeLargeEnv(count: number): Record<string, string> {
  const env: Record<string, string> = {};
  // Include some that match the allowlist
  env['HOME'] = '/Users/test';
  env['PATH'] = '/usr/bin:/bin';
  env['USER'] = 'test';
  env['SHELL'] = '/bin/zsh';
  env['TERM'] = 'xterm-256color';
  env['LANG'] = 'en_US.UTF-8';
  env['NVM_DIR'] = '/Users/test/.nvm';
  env['AGENSHIELD_PORT'] = '5200';
  // Fill the rest with non-matching vars
  for (let i = 0; i < count - 8; i++) {
    env[`CUSTOM_VAR_${i}`] = `value_${i}_${'x'.repeat(50)}`;
  }
  return env;
}

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-perf-'));
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── 1. Profile generation throughput ─────────────────────────────────────────

describe('Profile generation throughput', () => {
  it('generates > 5,000 profiles/sec (pure string building)', () => {
    const pm = new ProfileManager(path.join(tempDir, 'gen'));
    const config = makeSandboxConfig();
    const count = 1000;

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      pm.generateProfile(config);
    }
    const elapsed = performance.now() - start;
    const throughput = opsPerSec(count, elapsed);

    console.log(`generateProfile: ${throughput} ops/sec (${count} in ${elapsed.toFixed(1)}ms)`);
    expect(throughput).toBeGreaterThan(5000);
  });
});

// ── 2. Profile caching — sync ────────────────────────────────────────────────

describe('Profile caching — sync (getOrCreateProfile)', () => {
  it('cache miss: > 500 ops/sec creating unique profiles', () => {
    const dir = path.join(tempDir, 'cache-miss-sync');
    const pm = new ProfileManager(dir);
    const count = 500;

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      pm.getOrCreateProfile(`(version 1)(deny default) ;; unique-${i}`);
    }
    const elapsed = performance.now() - start;
    const throughput = opsPerSec(count, elapsed);

    console.log(`getOrCreateProfile cache miss: ${throughput} ops/sec (${count} in ${elapsed.toFixed(1)}ms)`);
    expect(throughput).toBeGreaterThan(500);
  });

  it('cache hit: > 2,000 ops/sec for identical content', () => {
    const dir = path.join(tempDir, 'cache-hit-sync');
    const pm = new ProfileManager(dir);
    const content = '(version 1)(deny default) ;; cached';
    const count = 1000;

    // Prime the cache
    pm.getOrCreateProfile(content);

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      pm.getOrCreateProfile(content);
    }
    const elapsed = performance.now() - start;
    const throughput = opsPerSec(count, elapsed);

    console.log(`getOrCreateProfile cache hit: ${throughput} ops/sec (${count} in ${elapsed.toFixed(1)}ms)`);
    expect(throughput).toBeGreaterThan(2000);
  });
});

// ── 3. Profile caching — async ───────────────────────────────────────────────

describe('Profile caching — async (getOrCreateProfileAsync)', () => {
  it('cache miss: > 500 ops/sec creating unique profiles', async () => {
    const dir = path.join(tempDir, 'cache-miss-async');
    const pm = new ProfileManager(dir);
    const count = 500;

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      await pm.getOrCreateProfileAsync(`(version 1)(deny default) ;; unique-async-${i}`);
    }
    const elapsed = performance.now() - start;
    const throughput = opsPerSec(count, elapsed);

    console.log(`getOrCreateProfileAsync cache miss: ${throughput} ops/sec (${count} in ${elapsed.toFixed(1)}ms)`);
    expect(throughput).toBeGreaterThan(500);
  });

  it('cache hit: > 2,000 ops/sec for identical content', async () => {
    const dir = path.join(tempDir, 'cache-hit-async');
    const pm = new ProfileManager(dir);
    const content = '(version 1)(deny default) ;; cached-async';
    const count = 1000;

    // Prime the cache
    await pm.getOrCreateProfileAsync(content);

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      await pm.getOrCreateProfileAsync(content);
    }
    const elapsed = performance.now() - start;
    const throughput = opsPerSec(count, elapsed);

    console.log(`getOrCreateProfileAsync cache hit: ${throughput} ops/sec (${count} in ${elapsed.toFixed(1)}ms)`);
    expect(throughput).toBeGreaterThan(2000);
  });
});

// ── 4. buildSandboxConfig throughput ─────────────────────────────────────────

describe('buildSandboxConfig throughput', () => {
  it('> 1,000 ops/sec with 0 policies', async () => {
    const deps = makeDeps();
    const input: BuildSandboxInput = { target: '/usr/bin/ls' };
    const count = 500;

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      await buildSandboxConfig(deps, input);
    }
    const elapsed = performance.now() - start;
    const throughput = opsPerSec(count, elapsed);

    console.log(`buildSandboxConfig (0 policies): ${throughput} ops/sec (${count} in ${elapsed.toFixed(1)}ms)`);
    expect(throughput).toBeGreaterThan(1000);
  });

  it('> 500 ops/sec with 10 policies', async () => {
    const policies = makePolicies(10);
    const deps = makeDeps({ getPolicies: () => policies });
    const input: BuildSandboxInput = { target: '/usr/bin/curl' };
    const count = 500;

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      await buildSandboxConfig(deps, input);
    }
    const elapsed = performance.now() - start;
    const throughput = opsPerSec(count, elapsed);

    console.log(`buildSandboxConfig (10 policies): ${throughput} ops/sec (${count} in ${elapsed.toFixed(1)}ms)`);
    expect(throughput).toBeGreaterThan(500);
  });

  it('> 200 ops/sec with 50 policies', async () => {
    const policies = makePolicies(50);
    const deps = makeDeps({ getPolicies: () => policies });
    const input: BuildSandboxInput = { target: '/usr/bin/curl' };
    const count = 500;

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      await buildSandboxConfig(deps, input);
    }
    const elapsed = performance.now() - start;
    const throughput = opsPerSec(count, elapsed);

    console.log(`buildSandboxConfig (50 policies): ${throughput} ops/sec (${count} in ${elapsed.toFixed(1)}ms)`);
    expect(throughput).toBeGreaterThan(200);
  });
});

// ── 5. Environment filtering ─────────────────────────────────────────────────

describe('Environment filtering (filterEnvByAllowlist)', () => {
  it('> 10,000 ops/sec filtering 200-var environment', () => {
    const env = makeLargeEnv(200);
    const count = 10_000;

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      filterEnvByAllowlist(env);
    }
    const elapsed = performance.now() - start;
    const throughput = opsPerSec(count, elapsed);

    console.log(`filterEnvByAllowlist (200 vars): ${throughput} ops/sec (${count} in ${elapsed.toFixed(1)}ms)`);
    expect(throughput).toBeGreaterThan(10_000);
  });
});

// ── 6. Profile cleanup at scale ──────────────────────────────────────────────

describe('Profile cleanup at scale', () => {
  function createTestProfiles(dir: string, count: number, oldCount: number): void {
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const filePath = path.join(dir, `sb-test${i.toString().padStart(6, '0')}.sb`);
      fs.writeFileSync(filePath, `(version 1) ;; test ${i}`);
      // Make half old
      if (i < oldCount) {
        const oldTime = new Date(now - 2 * 60 * 60 * 1000); // 2 hours ago
        fs.utimesSync(filePath, oldTime, oldTime);
      }
    }
  }

  it('sync cleanup < 1,000ms for 500 files', () => {
    const dir = path.join(tempDir, 'cleanup-sync');
    createTestProfiles(dir, 500, 250);

    const pm = new ProfileManager(dir);
    const start = performance.now();
    pm.cleanup(60 * 60 * 1000); // 1 hour
    const elapsed = performance.now() - start;

    console.log(`cleanup sync (500 files): ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000);

    // Verify correct files removed
    const remaining = fs.readdirSync(dir).filter(f => f.endsWith('.sb'));
    expect(remaining.length).toBe(250);
  });

  it('async cleanup < 1,000ms for 500 files', async () => {
    const dir = path.join(tempDir, 'cleanup-async');
    createTestProfiles(dir, 500, 250);

    const pm = new ProfileManager(dir);
    const start = performance.now();
    await pm.cleanupAsync(60 * 60 * 1000); // 1 hour
    const elapsed = performance.now() - start;

    console.log(`cleanupAsync (500 files): ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000);

    // Verify correct files removed
    const remaining = fs.readdirSync(dir).filter(f => f.endsWith('.sb'));
    expect(remaining.length).toBe(250);
  });
});

// ── 7. Concurrent profile generation ─────────────────────────────────────────

describe('Concurrent profile generation under load', () => {
  it('100 concurrent pipelines complete < 5,000ms', async () => {
    const dir = path.join(tempDir, 'concurrent');
    const pm = new ProfileManager(dir);
    const deps = makeDeps();
    const concurrency = 100;

    const start = performance.now();
    const promises = Array.from({ length: concurrency }, async (_, i) => {
      const config = await buildSandboxConfig(deps, {
        target: `/usr/bin/tool-${i}`,
      });
      const content = pm.generateProfile(config);
      return pm.getOrCreateProfileAsync(content);
    });

    await Promise.all(promises);
    const elapsed = performance.now() - start;

    console.log(`Concurrent ${concurrency} pipelines: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(5000);
  });
});

// ── 8. Event loop blocking audit ─────────────────────────────────────────────

describe('Event loop blocking audit', () => {
  it('generateProfile ×1,000: maxLag < 10ms', async () => {
    const pm = new ProfileManager(path.join(tempDir, 'lag-gen'));
    const config = makeSandboxConfig();

    const lag = await measureEventLoopLag(() => {
      for (let i = 0; i < 1000; i++) {
        pm.generateProfile(config);
      }
    });

    console.log(`generateProfile ×1000: maxLag=${lag.maxLagMs.toFixed(2)}ms p99=${lag.p99LagMs.toFixed(2)}ms`);
    expect(lag.maxLagMs).toBeLessThan(10);
  });

  it('getOrCreateProfile cache hit ×100: block < 50ms', async () => {
    const dir = path.join(tempDir, 'lag-cache');
    const pm = new ProfileManager(dir);
    const content = '(version 1)(deny default) ;; lag-test';
    pm.getOrCreateProfile(content);

    const block = await measureEventLoopBlock(() => {
      for (let i = 0; i < 100; i++) {
        pm.getOrCreateProfile(content);
      }
    });

    console.log(`getOrCreateProfile cache hit ×100: block=${block.toFixed(2)}ms`);
    expect(block).toBeLessThan(50);
  });

  it('filterEnvByAllowlist ×10,000: maxLag < 10ms', async () => {
    const env = makeLargeEnv(200);

    const lag = await measureEventLoopLag(() => {
      for (let i = 0; i < 10_000; i++) {
        filterEnvByAllowlist(env);
      }
    });

    console.log(`filterEnvByAllowlist ×10000: maxLag=${lag.maxLagMs.toFixed(2)}ms p99=${lag.p99LagMs.toFixed(2)}ms`);
    expect(lag.maxLagMs).toBeLessThan(10);
  });

  it('buildSandboxConfig (no proxy) ×50: maxLag < 50ms', async () => {
    const deps = makeDeps();
    const input: BuildSandboxInput = { target: '/usr/bin/ls' };

    const lag = await measureEventLoopLag(async () => {
      for (let i = 0; i < 50; i++) {
        await buildSandboxConfig(deps, input);
      }
    });

    console.log(`buildSandboxConfig ×50: maxLag=${lag.maxLagMs.toFixed(2)}ms p99=${lag.p99LagMs.toFixed(2)}ms`);
    expect(lag.maxLagMs).toBeLessThan(50);
  });

  it('getOrCreateProfileAsync ×100: maxLag < 10ms (non-blocking)', async () => {
    const dir = path.join(tempDir, 'lag-async');
    const pm = new ProfileManager(dir);
    const content = '(version 1)(deny default) ;; async-lag';
    await pm.getOrCreateProfileAsync(content);

    const lag = await measureEventLoopLag(async () => {
      for (let i = 0; i < 100; i++) {
        await pm.getOrCreateProfileAsync(content);
      }
    });

    console.log(`getOrCreateProfileAsync ×100: maxLag=${lag.maxLagMs.toFixed(2)}ms p99=${lag.p99LagMs.toFixed(2)}ms`);
    expect(lag.maxLagMs).toBeLessThan(10);
  });
});
