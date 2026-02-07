/**
 * E2E Test: URL (Network) Policy Enforcement
 *
 * Tests policy_check RPC for http_request operations:
 * - Default behavior (fail-open for HTTPS, HTTP blocked)
 * - Deny/allow policies
 * - Pattern matching (bare domains, wildcards, sub-paths)
 * - Priority ordering
 * - Enable/disable toggle
 * - Operations filter
 */

import { policyCheck, setPolicies, clearPolicies, makePolicy } from '../setup/helpers';

describe('URL policy enforcement', () => {
  afterEach(async () => {
    await clearPolicies();
  });

  // ─── Default Behavior ──────────────────────────────────────────────────────

  describe('default behavior (no policies)', () => {
    it('allows HTTPS requests (fail-open)', async () => {
      const result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(true);
    });

    it('blocks plain HTTP by default', async () => {
      const result = await policyCheck('http_request', 'http://example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('HTTP');
    });
  });

  // ─── Deny Policies ────────────────────────────────────────────────────────

  describe('deny policies', () => {
    it('denies matching URL', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Example',
          action: 'deny',
          target: 'url',
          patterns: ['example.com'],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(false);
      expect(result.policyId).toBeDefined();
      expect(result.reason).toContain('Block Example');
    });

    it('denies sub-paths of matching URL', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block API',
          action: 'deny',
          target: 'url',
          patterns: ['https://api.example.com'],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://api.example.com/users');
      expect(result.allowed).toBe(false);
    });

    it('does not match sub-path-like strings (no path traversal abuse)', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block v1',
          action: 'deny',
          target: 'url',
          patterns: ['https://example.com/v1'],
        }),
      ]);

      // /v1-evil is NOT a sub-path of /v1
      const result = await policyCheck('http_request', 'https://example.com/v1-evil');
      expect(result.allowed).toBe(true);
    });

    it('still allows non-matching URLs', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Example',
          action: 'deny',
          target: 'url',
          patterns: ['example.com'],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://other.com');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Allow Policies ────────────────────────────────────────────────────────

  describe('allow policies', () => {
    it('explicit http:// allow overrides default HTTP block', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow Internal HTTP',
          action: 'allow',
          target: 'url',
          patterns: ['http://internal.local'],
        }),
      ]);

      const result = await policyCheck('http_request', 'http://internal.local');
      expect(result.allowed).toBe(true);
    });

    it('non-matching http:// allow still blocks other HTTP', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow Internal HTTP',
          action: 'allow',
          target: 'url',
          patterns: ['http://internal.local'],
        }),
      ]);

      const result = await policyCheck('http_request', 'http://other-site.com');
      expect(result.allowed).toBe(false);
    });
  });

  // ─── Pattern Matching ─────────────────────────────────────────────────────

  describe('pattern matching', () => {
    it('bare domain is auto-prefixed with https://', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Bare Domain',
          action: 'deny',
          target: 'url',
          patterns: ['example.com'],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(false);
    });

    it('single * matches one path segment', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Single Level',
          action: 'deny',
          target: 'url',
          patterns: ['https://example.com/*'],
        }),
      ]);

      const shallow = await policyCheck('http_request', 'https://example.com/anything');
      expect(shallow.allowed).toBe(false);

      const deep = await policyCheck('http_request', 'https://example.com/a/b');
      expect(deep.allowed).toBe(true); // * doesn't match across /
    });

    it('** (globstar) matches across path segments', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Deep',
          action: 'deny',
          target: 'url',
          patterns: ['https://example.com/**'],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://example.com/a/b/c');
      expect(result.allowed).toBe(false);
    });

    it('wildcard subdomain matching', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block GitHub Subdomains',
          action: 'deny',
          target: 'url',
          patterns: ['https://*.github.com'],
        }),
      ]);

      const api = await policyCheck('http_request', 'https://api.github.com');
      expect(api.allowed).toBe(false);

      const raw = await policyCheck('http_request', 'https://raw.github.com');
      expect(raw.allowed).toBe(false);
    });

    it('multiple patterns in one policy', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Multiple',
          action: 'deny',
          target: 'url',
          patterns: ['example.com', 'evil.com'],
        }),
      ]);

      const r1 = await policyCheck('http_request', 'https://example.com');
      expect(r1.allowed).toBe(false);

      const r2 = await policyCheck('http_request', 'https://evil.com');
      expect(r2.allowed).toBe(false);

      const r3 = await policyCheck('http_request', 'https://safe.com');
      expect(r3.allowed).toBe(true);
    });
  });

  // ─── Priority ──────────────────────────────────────────────────────────────

  describe('priority ordering', () => {
    it('higher-priority allow overrides lower-priority deny', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block All Example',
          action: 'deny',
          target: 'url',
          patterns: ['*.example.com'],
          priority: 10,
        }),
        makePolicy({
          name: 'Allow API',
          action: 'allow',
          target: 'url',
          patterns: ['api.example.com'],
          priority: 20,
        }),
      ]);

      const api = await policyCheck('http_request', 'https://api.example.com');
      expect(api.allowed).toBe(true);

      const www = await policyCheck('http_request', 'https://www.example.com');
      expect(www.allowed).toBe(false);
    });
  });

  // ─── Enable/Disable ───────────────────────────────────────────────────────

  describe('enable/disable toggle', () => {
    it('disabled policy has no effect', async () => {
      const policy = makePolicy({
        name: 'Block Example (disabled)',
        action: 'deny',
        target: 'url',
        patterns: ['example.com'],
        enabled: false,
      });

      await setPolicies([policy]);

      const result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(true);
    });

    it('re-enabling policy enforces it', async () => {
      const policy = makePolicy({
        name: 'Block Example',
        action: 'deny',
        target: 'url',
        patterns: ['example.com'],
        enabled: false,
      });

      await setPolicies([policy]);

      // Disabled - should be allowed
      let result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(true);

      // Enable the policy
      await setPolicies([{ ...policy, enabled: true }]);

      result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(false);
    });
  });

  // ─── Operations Filter ────────────────────────────────────────────────────

  describe('operations filter', () => {
    it('policy with non-matching operations filter has no effect', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Example (wrong op)',
          action: 'deny',
          target: 'url',
          patterns: ['example.com'],
          operations: ['file_read'], // Not http_request
        }),
      ]);

      const result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(true);
    });
  });
});
