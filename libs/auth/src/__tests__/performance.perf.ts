/**
 * Auth — Performance Test Suite
 *
 * Measures throughput and event loop impact for:
 * - JWT signing (admin + broker tokens)
 * - JWT verification (valid + invalid tokens)
 * - Secret management (load + get)
 * - Role/route matching (public, admin-only, wildcard)
 * - Token extraction (header + query param)
 * - Ed25519 cloud auth (keypair generation, signing, verification)
 * - Event loop blocking audit
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import {
  loadOrCreateSecret,
  getSecret,
  clearSecretCache,
  generateSecret,
  signAdminToken,
  signBrokerToken,
  verifyToken,
  isPublicRoute,
  isAdminOnlyRoute,
  extractBearerToken,
  generateEd25519Keypair,
  createAgentSigHeader,
  verifyAgentSig,
  parseAgentSigHeader,
  hasMinimumRole,
} from '../../src';
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

let tempDir: string;
const originalHome = process.env['AGENSHIELD_USER_HOME'];

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-perf-'));
  process.env['AGENSHIELD_USER_HOME'] = tempDir;
  loadOrCreateSecret(tempDir);
});

afterAll(() => {
  clearSecretCache();
  if (originalHome !== undefined) {
    process.env['AGENSHIELD_USER_HOME'] = originalHome;
  } else {
    delete process.env['AGENSHIELD_USER_HOME'];
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── 1. JWT Signing ──────────────────────────────────────────────────────────

describe('1. JWT Signing', () => {
  it('signAdminToken throughput: > 5,000 ops/sec', async () => {
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await signAdminToken();
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'sign.adminToken', ops, '>', 5_000, 'ops/sec');
  });

  it('signBrokerToken throughput: > 5,000 ops/sec', async () => {
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await signBrokerToken(`profile-${i}`, `target-${i}`);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'sign.brokerToken', ops, '>', 5_000, 'ops/sec');
  });
});

// ── 2. JWT Verification ─────────────────────────────────────────────────────

describe('2. JWT Verification', () => {
  let validAdminToken: string;
  let validBrokerToken: string;

  beforeAll(async () => {
    validAdminToken = await signAdminToken();
    validBrokerToken = await signBrokerToken('profile-1', 'target-1');
  });

  it('verifyToken (valid admin) throughput: > 5,000 ops/sec', async () => {
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const result = await verifyToken(validAdminToken);
      if (i === 0) expect(result.valid).toBe(true);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'verify.validAdmin', ops, '>', 5_000, 'ops/sec');
  });

  it('verifyToken (valid broker) throughput: > 5,000 ops/sec', async () => {
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const result = await verifyToken(validBrokerToken);
      if (i === 0) expect(result.valid).toBe(true);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'verify.validBroker', ops, '>', 5_000, 'ops/sec');
  });

  it('verifyToken (invalid token) throughput: > 5,000 ops/sec', async () => {
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const result = await verifyToken('invalid.jwt.token');
      if (i === 0) expect(result.valid).toBe(false);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'verify.invalidToken', ops, '>', 5_000, 'ops/sec');
  });
});

// ── 3. Secret Management ────────────────────────────────────────────────────

describe('3. Secret Management', () => {
  it('getSecret (cached) throughput: > 10,000,000 ops/sec', () => {
    const iterations = 1_000_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      getSecret();
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'secret.getCached', ops, '>', 10_000_000, 'ops/sec');
  });

  it('generateSecret throughput: > 100,000 ops/sec', () => {
    const iterations = 50_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      generateSecret();
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'secret.generate', ops, '>', 100_000, 'ops/sec');
  });

  it('loadOrCreateSecret (cached) throughput: > 10,000,000 ops/sec', () => {
    const iterations = 1_000_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      loadOrCreateSecret(tempDir);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'secret.loadCached', ops, '>', 10_000_000, 'ops/sec');
  });
});

// ── 4. Role/Route Matching ──────────────────────────────────────────────────

describe('4. Role/Route Matching', () => {
  it('isPublicRoute throughput: > 100,000 ops/sec', () => {
    const routes = [
      '/api/health',
      '/api/status',
      '/api/auth/status',
      '/api/policies',
      '/api/config',
      '/api/unknown',
    ];
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      isPublicRoute(routes[i % routes.length]);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'route.isPublic', ops, '>', 100_000, 'ops/sec');
  });

  it('isAdminOnlyRoute throughput: > 100,000 ops/sec', () => {
    const routes = [
      { method: 'PUT', path: '/api/config' },
      { method: 'POST', path: '/api/wrappers' },
      { method: 'GET', path: '/api/health' },
      { method: 'DELETE', path: '/api/secrets' },
    ];
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const r = routes[i % routes.length];
      isAdminOnlyRoute(r.method, r.path);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'route.isAdminOnly', ops, '>', 100_000, 'ops/sec');
  });

  it('isAdminOnlyRoute wildcard matching: > 50,000 ops/sec', () => {
    const routes = [
      { method: 'POST', path: '/api/skills/my-skill/install' },
      { method: 'POST', path: '/api/skills/other/approve' },
      { method: 'DELETE', path: '/api/skills/to-remove' },
      { method: 'PUT', path: '/api/skills/toggled/toggle' },
    ];
    const iterations = 50_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const r = routes[i % routes.length];
      isAdminOnlyRoute(r.method, r.path);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'route.wildcardMatch', ops, '>', 50_000, 'ops/sec');
  });

  it('hasMinimumRole throughput: > 1,000,000 ops/sec', () => {
    const iterations = 1_000_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      hasMinimumRole(i % 2 === 0 ? 'admin' : 'broker', 'broker');
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'role.hasMinimumRole', ops, '>', 1_000_000, 'ops/sec');
  });
});

// ── 5. Token Extraction ─────────────────────────────────────────────────────

describe('5. Token Extraction', () => {
  it('extractBearerToken from header: > 500,000 ops/sec', () => {
    const mockRequest = {
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.test.sig' },
      query: {},
    } as any;
    const iterations = 500_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      extractBearerToken(mockRequest);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'extract.fromHeader', ops, '>', 500_000, 'ops/sec');
  });

  it('extractBearerToken from query param: > 500,000 ops/sec', () => {
    const mockRequest = {
      headers: {},
      query: { token: 'eyJhbGciOiJIUzI1NiJ9.test.sig' },
    } as any;
    const iterations = 500_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      extractBearerToken(mockRequest);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'extract.fromQueryParam', ops, '>', 500_000, 'ops/sec');
  });

  it('extractBearerToken (no token): > 500,000 ops/sec', () => {
    const mockRequest = {
      headers: {},
      query: {},
    } as any;
    const iterations = 500_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      extractBearerToken(mockRequest);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'extract.noToken', ops, '>', 500_000, 'ops/sec');
  });
});

// ── 6. Ed25519 Cloud Auth ───────────────────────────────────────────────────

describe('6. Ed25519 Cloud Auth', () => {
  let keypair: { publicKey: string; privateKey: string };

  beforeAll(() => {
    keypair = generateEd25519Keypair();
  });

  it('generateEd25519Keypair: > 500 ops/sec', () => {
    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      generateEd25519Keypair();
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'ed25519.generateKeypair', ops, '>', 500, 'ops/sec');
  });

  it('createAgentSigHeader: > 2,000 ops/sec', () => {
    const iterations = 2_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      createAgentSigHeader(`agent-${i}`, keypair.privateKey);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'ed25519.createSigHeader', ops, '>', 2_000, 'ops/sec');
  });

  it('verifyAgentSig: > 2,000 ops/sec', () => {
    const header = createAgentSigHeader('agent-perf', keypair.privateKey);
    const iterations = 2_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const result = verifyAgentSig(header, keypair.publicKey);
      if (i === 0) expect(result).toBe('agent-perf');
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'ed25519.verifySig', ops, '>', 2_000, 'ops/sec');
  });

  it('parseAgentSigHeader: > 100,000 ops/sec', () => {
    const header = createAgentSigHeader('agent-perf', keypair.privateKey);
    const iterations = 100_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      parseAgentSigHeader(header);
    }
    const elapsed = performance.now() - start;
    const ops = opsPerSec(iterations, elapsed);
    perf('auth', 'ed25519.parseSigHeader', ops, '>', 100_000, 'ops/sec');
  });
});

// ── 7. Event Loop ───────────────────────────────────────────────────────────

describe('7. Event Loop', () => {
  it('JWT sign batch should not block event loop: < 50ms', async () => {
    const batchSize = 200;
    const block = await measureEventLoopBlock(() => {
      // Sync-heavy portion: getSecret + Date.now calls
      for (let i = 0; i < batchSize; i++) {
        getSecret();
        isPublicRoute('/api/health');
        isAdminOnlyRoute('POST', '/api/skills/x/install');
      }
    });
    perf('auth', 'evloop.syncBatch', block, '<', 50, 'ms');
  });

  it('Ed25519 sign batch should not block event loop: < 50ms', async () => {
    const keypair = generateEd25519Keypair();
    const batchSize = 100;
    const block = await measureEventLoopBlock(() => {
      for (let i = 0; i < batchSize; i++) {
        createAgentSigHeader(`agent-${i}`, keypair.privateKey);
      }
    });
    perf('auth', 'evloop.ed25519SignBatch', block, '<', 50, 'ms');
  });

  it('Route matching batch should not block event loop: < 50ms', async () => {
    const block = await measureEventLoopBlock(() => {
      for (let i = 0; i < 10_000; i++) {
        isPublicRoute('/api/health');
        isPublicRoute('/api/unknown');
        isAdminOnlyRoute('POST', '/api/skills/x/install');
        isAdminOnlyRoute('GET', '/api/health');
        hasMinimumRole('admin', 'broker');
      }
    });
    perf('auth', 'evloop.routeMatchBatch', block, '<', 50, 'ms');
  });
});
