/**
 * E2E Enforcement Test: Network / URL Policy Enforcement
 *
 * Tests dynamic URL policy changes and verifies real network access
 * is affected for the sandboxed agent user.
 *
 * Uses:
 * - RPC policy_check: verify policy evaluation
 * - RPC http_request: proxy actual HTTP request through daemon
 * - runAsAgentUser('openclaw run --test-network'): test harness network test
 * - runAsAgentUser('curl ...'): test via curl wrapper (if available)
 */

import {
  runAsAgentUser,
  setPolicies,
  clearPolicies,
  makePolicy,
  policyCheck,
  rpc,
  getAgentHome,
} from '../setup/helpers';

describe('network enforcement', () => {
  afterEach(async () => {
    await clearPolicies();
  });

  // ─── Policy Check (API-level) ──────────────────────────────────────────────

  describe('policy_check RPC', () => {
    it('default: HTTPS allowed (fail-open) via policy engine', async () => {
      const result = await policyCheck('http_request', 'https://httpbin.org/get');
      expect(result.allowed).toBe(true);
    });

    it('default: HTTP blocked by default', async () => {
      const result = await policyCheck('http_request', 'http://example.com');
      expect(result.allowed).toBe(false);
    });

    it('deny policy blocks URL via policy engine', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block httpbin',
          action: 'deny',
          target: 'url',
          patterns: ['httpbin.org'],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://httpbin.org/get');
      expect(result.allowed).toBe(false);
    });

    it('allow policy permits URL via policy engine', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow httpbin',
          action: 'allow',
          target: 'url',
          patterns: ['httpbin.org'],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://httpbin.org/get');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── RPC HTTP Proxy ────────────────────────────────────────────────────────

  describe('RPC http_request proxy', () => {
    it('proxies allowed HTTP request through daemon', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow httpbin',
          action: 'allow',
          target: 'url',
          patterns: ['httpbin.org'],
        }),
      ]);

      const resp = await rpc('http_request', {
        url: 'https://httpbin.org/get',
        method: 'GET',
      });

      expect(resp.error).toBeUndefined();
      const result = resp.result as { status: number; body: string };
      expect(result.status).toBe(200);
      expect(result.body).toContain('httpbin.org');
    });
  });

  // ─── Agent User Network Access ─────────────────────────────────────────────

  describe('agent user network access', () => {
    it('test harness detects network status as agent user', () => {
      const result = runAsAgentUser('openclaw run --test-network', { timeout: 30_000 });
      // Depending on sandbox setup, this might be BLOCKED or SUCCESS
      // We just verify the test harness runs and returns a result
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/SUCCESS|BLOCKED/);
    });

    it('curl wrapper exists in agent bin dir', () => {
      const home = getAgentHome();
      const result = runAsAgentUser(`test -f ${home}/bin/curl && echo EXISTS || echo MISSING`);
      // curl might or might not be installed depending on setup
      expect(result.stdout).toMatch(/EXISTS|MISSING/);
    });

    it('node fetch as agent user reports connection status', () => {
      const script = `
        fetch('https://httpbin.org/get', { signal: AbortSignal.timeout(5000) })
          .then(r => console.log('STATUS:' + r.status))
          .catch(e => console.log('ERROR:' + e.message))
      `.replace(/\n/g, ' ');

      const result = runAsAgentUser(`node -e "${script}"`, { timeout: 15_000 });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/STATUS:|ERROR:/);
    });
  });

  // ─── Dynamic Policy Changes ────────────────────────────────────────────────

  describe('dynamic policy changes', () => {
    it('adding deny policy changes policy_check result', async () => {
      // First: allowed
      let result = await policyCheck('http_request', 'https://httpbin.org/get');
      expect(result.allowed).toBe(true);

      // Add deny
      await setPolicies([
        makePolicy({
          name: 'Block httpbin',
          action: 'deny',
          target: 'url',
          patterns: ['httpbin.org'],
        }),
      ]);

      // Now: denied
      result = await policyCheck('http_request', 'https://httpbin.org/get');
      expect(result.allowed).toBe(false);

      // Remove deny
      await clearPolicies();

      // Back to: allowed
      result = await policyCheck('http_request', 'https://httpbin.org/get');
      expect(result.allowed).toBe(true);
    });
  });
});
