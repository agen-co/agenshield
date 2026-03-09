/**
 * Interceptor — Performance Test Suite
 *
 * Measures throughput and event loop impact for:
 * - PolicyCache (set, get, has, prune, eviction)
 * - Config creation (createConfig)
 * - Event reporter (enqueue, overflow, sanitize)
 * - Proxy environment (getProxyConfig, shouldBypassProxy)
 * - URL classification
 * - Argument parsing (child_process spawn/exec args)
 * - Seatbelt profile (generation, sandbox flags)
 * - Event loop blocking audit
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PolicyCache } from '../policy/cache';
import { EventReporter } from '../events/reporter';
import type { InterceptorEvent } from '../events/reporter';
import { createConfig } from '../config';
import { getProxyConfig, shouldBypassProxy } from '../proxy-env';
import { ProfileManager } from '@agenshield/seatbelt';
import { filterEnvByAllowlist } from '@agenshield/seatbelt';
import { perf } from '../../../../tools/perf-metric';

jest.setTimeout(120_000);

// ── Helpers ──────────────────────────────────────────────────────────────────

function opsPerSec(count: number, elapsedMs: number): number {
  return Math.round((count / elapsedMs) * 1000);
}

function measureEventLoopBlock(syncFn: () => void): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => resolve(performance.now() - start), 0);
    syncFn();
  });
}

function makeEvent(overrides?: Partial<InterceptorEvent>): InterceptorEvent {
  return {
    type: 'allow',
    operation: 'exec',
    target: '/usr/bin/ls -la',
    timestamp: new Date(),
    ...overrides,
  };
}

function makeMockAsyncClient(): any {
  return {
    request: jest.fn().mockResolvedValue(undefined),
  };
}

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interceptor-perf-'));
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── 1. PolicyCache ──────────────────────────────────────────────────────────

describe('1. PolicyCache', () => {
  it('set throughput: > 100,000 ops/sec', () => {
    const cache = new PolicyCache({ ttl: 60_000, maxSize: 200_000 });
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      cache.set(`key-${i}`, { allowed: true, policyId: `p-${i}` });
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'cache.set', ops, '>', 100_000, 'ops/sec');
  });

  it('get (hit) throughput: > 100,000 ops/sec', () => {
    const cache = new PolicyCache({ ttl: 60_000, maxSize: 200_000 });
    const iterations = 100_000;
    // Pre-populate
    for (let i = 0; i < iterations; i++) {
      cache.set(`key-${i}`, { allowed: true });
    }

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      cache.get(`key-${i}`);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'cache.getHit', ops, '>', 100_000, 'ops/sec');
  });

  it('get (miss) throughput: > 100,000 ops/sec', () => {
    const cache = new PolicyCache({ ttl: 60_000 });
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      cache.get(`miss-${i}`);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'cache.getMiss', ops, '>', 100_000, 'ops/sec');
  });

  it('has throughput: > 100,000 ops/sec', () => {
    const cache = new PolicyCache({ ttl: 60_000, maxSize: 200_000 });
    const iterations = 100_000;
    for (let i = 0; i < iterations; i++) {
      cache.set(`key-${i}`, true);
    }
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      cache.has(`key-${i}`);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'cache.has', ops, '>', 100_000, 'ops/sec');
  });

  it('eviction overhead (set beyond maxSize): > 50,000 ops/sec', () => {
    const maxSize = 1_000;
    const cache = new PolicyCache({ ttl: 60_000, maxSize });
    // Fill to maxSize
    for (let i = 0; i < maxSize; i++) {
      cache.set(`pre-${i}`, true);
    }
    const iterations = 50_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      cache.set(`overflow-${i}`, { evicted: true });
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'cache.eviction', ops, '>', 50_000, 'ops/sec');
  });

  it('prune throughput: > 1,000 ops/sec (1000 entries, half expired)', () => {
    const iterations = 1_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const cache = new PolicyCache({ ttl: 1, maxSize: 2_000 });
      // Add entries: half with 0ms TTL (expired), half with 60s TTL
      for (let j = 0; j < 500; j++) {
        cache.set(`expired-${j}`, true, 0);
      }
      for (let j = 0; j < 500; j++) {
        cache.set(`valid-${j}`, true, 60_000);
      }
      cache.prune();
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'cache.prune', ops, '>', 1_000, 'ops/sec');
  });
});

// ── 2. Config Creation ──────────────────────────────────────────────────────

describe('2. Config Creation', () => {
  it('createConfig throughput: > 50,000 ops/sec', () => {
    const iterations = 50_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      createConfig();
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'config.create', ops, '>', 50_000, 'ops/sec');
  });

  it('createConfig with overrides: > 50,000 ops/sec', () => {
    const overrides = {
      failOpen: true,
      logLevel: 'debug' as const,
      timeout: 10_000,
      interceptFetch: false,
    };
    const iterations = 50_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      createConfig(overrides);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'config.createWithOverrides', ops, '>', 50_000, 'ops/sec');
  });
});

// ── 3. Event Reporter ───────────────────────────────────────────────────────

describe('3. Event Reporter', () => {
  it('report() enqueue throughput: > 100,000 ops/sec', () => {
    const client = makeMockAsyncClient();
    const reporter = new EventReporter({ client, logLevel: 'error' });
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      reporter.report(makeEvent({ target: `/usr/bin/cmd-${i}` }));
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    reporter.stop();
    perf('interceptor', 'reporter.enqueue', ops, '>', 100_000, 'ops/sec');
  });

  it('report() queue overflow (> 500 events) handles gracefully', () => {
    const client = makeMockAsyncClient();
    const reporter = new EventReporter({ client, logLevel: 'error' });
    const iterations = 1_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      reporter.report(makeEvent({ target: `/usr/bin/overflow-${i}` }));
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    reporter.stop();
    perf('interceptor', 'reporter.overflow', ops, '>', 10_000, 'ops/sec');
  });

  it('sanitizeTarget throughput (long targets): > 100,000 ops/sec', () => {
    const client = makeMockAsyncClient();
    const reporter = new EventReporter({ client, logLevel: 'error' });
    const longTarget = 'x'.repeat(2000);
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      reporter.report(makeEvent({ target: longTarget }));
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    reporter.stop();
    perf('interceptor', 'reporter.sanitizeLong', ops, '>', 100_000, 'ops/sec');
  });

  it('sanitizeTarget with heredoc pattern: > 100,000 ops/sec', () => {
    const client = makeMockAsyncClient();
    const reporter = new EventReporter({ client, logLevel: 'error' });
    const heredocTarget = `cat <<EOF\n${'line\n'.repeat(200)}EOF`;
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      reporter.report(makeEvent({ target: heredocTarget }));
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    reporter.stop();
    perf('interceptor', 'reporter.sanitizeHeredoc', ops, '>', 100_000, 'ops/sec');
  });
});

// ── 4. Proxy Environment ────────────────────────────────────────────────────

describe('4. Proxy Environment', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy']) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('getProxyConfig (no proxy) throughput: > 500,000 ops/sec', () => {
    delete process.env['HTTP_PROXY'];
    delete process.env['HTTPS_PROXY'];
    delete process.env['http_proxy'];
    delete process.env['https_proxy'];
    const iterations = 500_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      getProxyConfig();
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'proxy.getConfigNoProxy', ops, '>', 500_000, 'ops/sec');
  });

  it('getProxyConfig (with proxy) throughput: > 5,000 ops/sec', () => {
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:8080';
    process.env['NO_PROXY'] = 'localhost,127.0.0.1,.internal.corp';
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      getProxyConfig();
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'proxy.getConfigWithProxy', ops, '>', 5_000, 'ops/sec');
  });

  it('shouldBypassProxy exact match: > 500,000 ops/sec', () => {
    const noProxy = ['localhost', '127.0.0.1', 'example.com', 'internal.corp'];
    const iterations = 500_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      shouldBypassProxy('http://localhost:3000/api', noProxy);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'proxy.bypassExact', ops, '>', 500_000, 'ops/sec');
  });

  it('shouldBypassProxy suffix match: > 500,000 ops/sec', () => {
    const noProxy = ['.internal.corp', '.local.dev', '.svc.cluster.local'];
    const iterations = 500_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      shouldBypassProxy('http://api.internal.corp/test', noProxy);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'proxy.bypassSuffix', ops, '>', 500_000, 'ops/sec');
  });

  it('shouldBypassProxy wildcard: > 500,000 ops/sec', () => {
    const noProxy = ['*'];
    const iterations = 500_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      shouldBypassProxy('http://any-host.example.com/path', noProxy);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'proxy.bypassWildcard', ops, '>', 500_000, 'ops/sec');
  });

  it('shouldBypassProxy (no match): > 200,000 ops/sec', () => {
    const noProxy = ['localhost', '127.0.0.1', '.internal.corp'];
    const iterations = 200_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      shouldBypassProxy('https://external-api.example.com/v1/data', noProxy);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'proxy.bypassNoMatch', ops, '>', 200_000, 'ops/sec');
  });
});

// ── 5. URL Classification ───────────────────────────────────────────────────

describe('5. URL Classification', () => {
  it('classify URLs as HTTP/HTTPS/bypass: > 200,000 ops/sec', () => {
    const urls = [
      'http://example.com/api/v1',
      'https://secure.example.com/data',
      'http://localhost:3000/health',
      'https://api.internal.corp:8443/query',
      'http://127.0.0.1:5200/status',
    ];
    const noProxy = ['localhost', '127.0.0.1'];
    const iterations = 200_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const url = urls[i % urls.length];
      shouldBypassProxy(url, noProxy);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'url.classify', ops, '>', 200_000, 'ops/sec');
  });

  it('URL parsing throughput: > 200,000 ops/sec', () => {
    const urls = [
      'http://example.com/path?q=1',
      'https://api.corp.internal:9090/v2/resource',
      'http://user:pass@proxy.local:3128',
    ];
    const iterations = 200_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      new URL(urls[i % urls.length]);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'url.parse', ops, '>', 200_000, 'ops/sec');
  });
});

// ── 6. Argument Parsing ─────────────────────────────────────────────────────

describe('6. Argument Parsing', () => {
  it('parse spawn-style args: > 100,000 ops/sec', () => {
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      // Simulate the argument parsing that happens in child_process interceptor
      const command = '/usr/bin/node';
      const args = ['--max-old-space-size=4096', 'index.js', '--port', '3000'];
      const fullCommand = [command, ...args].join(' ');
      // Basic parsing: extract binary and first arg
      fullCommand.split(' ');
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'args.parseSpawn', ops, '>', 100_000, 'ops/sec');
  });

  it('parse exec-style command string: > 100,000 ops/sec', () => {
    const commands = [
      'ls -la /tmp',
      'curl -s https://api.example.com/data | jq .',
      'NODE_ENV=production node server.js --port 3000',
      'git commit -m "feat: add new feature"',
      'docker run --rm -v /data:/data alpine sh -c "echo hello"',
    ];
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const cmd = commands[i % commands.length];
      cmd.split(/\s+/);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'args.parseExec', ops, '>', 100_000, 'ops/sec');
  });

  it('env filtering (filterEnvByAllowlist): > 10,000 ops/sec', () => {
    const env: Record<string, string> = {
      HOME: '/Users/test',
      PATH: '/usr/bin:/bin',
      USER: 'test',
      SHELL: '/bin/zsh',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      AGENSHIELD_PORT: '5200',
      SECRET_KEY: 'should-be-filtered',
      AWS_ACCESS_KEY: 'should-be-filtered',
      DATABASE_URL: 'postgres://localhost/db',
    };
    for (let i = 0; i < 90; i++) {
      env[`CUSTOM_VAR_${i}`] = `value_${i}`;
    }
    const iterations = 10_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      filterEnvByAllowlist(env);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'args.envFilter', ops, '>', 10_000, 'ops/sec');
  });
});

// ── 7. Seatbelt Profile ─────────────────────────────────────────────────────

describe('7. Seatbelt Profile', () => {
  it('profile path resolution: > 50,000 ops/sec', () => {
    const pm = new ProfileManager(path.join(tempDir, 'profile-resolve'));
    const content = '(version 1)(deny default)(allow file-read* (subpath "/tmp"))';
    // Prime it
    pm.getOrCreateProfile(content);

    const iterations = 50_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      pm.getOrCreateProfile(content);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'seatbelt.profileResolve', ops, '>', 50_000, 'ops/sec');
  });

  it('sandbox flag generation (generateProfile): > 5,000 ops/sec', () => {
    const pm = new ProfileManager(path.join(tempDir, 'profile-gen'));
    const sandboxConfig = {
      enabled: true,
      allowedReadPaths: ['/tmp', '/var', '/usr/lib'],
      allowedWritePaths: ['/tmp'],
      deniedPaths: ['/etc/secrets', '/private'],
      networkAllowed: true,
      allowedHosts: ['localhost', '127.0.0.1'],
      allowedPorts: [8080, 3000],
      allowedBinaries: ['/usr/bin/curl', '/usr/bin/node', '/usr/bin/git'],
      deniedBinaries: ['/usr/bin/rm', '/usr/bin/sudo'],
      envInjection: { HTTP_PROXY: 'http://127.0.0.1:9999' },
      envDeny: ['SECRET_KEY', 'AWS_ACCESS_KEY'],
      envAllow: ['MY_VAR', 'PATH'],
      brokerHttpPort: 5201,
    };
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      pm.generateProfile(sandboxConfig);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'seatbelt.generateProfile', ops, '>', 5_000, 'ops/sec');
  });

  it('profile cache miss (unique content): > 500 ops/sec', () => {
    const dir = path.join(tempDir, 'profile-miss');
    const pm = new ProfileManager(dir);
    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      pm.getOrCreateProfile(`(version 1)(deny default) ;; unique-${i}`);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('interceptor', 'seatbelt.cacheMiss', ops, '>', 500, 'ops/sec');
  });
});

// ── 8. Event Loop ───────────────────────────────────────────────────────────

describe('8. Event Loop', () => {
  it('batch policy cache ops should not block event loop: < 50ms', async () => {
    const cache = new PolicyCache({ ttl: 60_000, maxSize: 20_000 });
    const block = await measureEventLoopBlock(() => {
      for (let i = 0; i < 10_000; i++) {
        cache.set(`key-${i}`, { allowed: true });
      }
      for (let i = 0; i < 10_000; i++) {
        cache.get(`key-${i}`);
      }
    });
    perf('interceptor', 'evloop.cacheOps', block, '<', 50, 'ms');
  });

  it('config creation batch should not block event loop: < 50ms', async () => {
    const block = await measureEventLoopBlock(() => {
      for (let i = 0; i < 10_000; i++) {
        createConfig();
      }
    });
    perf('interceptor', 'evloop.configCreate', block, '<', 50, 'ms');
  });

  it('proxy bypass check batch should not block event loop: < 50ms', async () => {
    const noProxy = ['localhost', '127.0.0.1', '.internal.corp', '.svc.cluster.local'];
    const block = await measureEventLoopBlock(() => {
      for (let i = 0; i < 50_000; i++) {
        shouldBypassProxy('http://api.example.com/test', noProxy);
      }
    });
    perf('interceptor', 'evloop.proxyBypass', block, '<', 50, 'ms');
  });

  it('event reporter enqueue batch should not block event loop: < 50ms', async () => {
    const client = makeMockAsyncClient();
    const reporter = new EventReporter({ client, logLevel: 'error' });
    const block = await measureEventLoopBlock(() => {
      for (let i = 0; i < 10_000; i++) {
        reporter.report(makeEvent({ target: `/cmd-${i}` }));
      }
    });
    reporter.stop();
    perf('interceptor', 'evloop.reporterEnqueue', block, '<', 50, 'ms');
  });
});
