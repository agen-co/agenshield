/**
 * E2E Test: Cross-Cutting Policy Behaviors
 *
 * Tests behaviors that span across policy types:
 * - Type isolation (URL policy doesn't affect exec)
 * - Approval action behavior
 * - Empty patterns
 * - Case insensitivity for URLs
 * - Multiple policy types simultaneously
 */

import { policyCheck, setPolicies, clearPolicies, makePolicy } from '../setup/helpers';

describe('cross-cutting policy behaviors', () => {
  afterEach(async () => {
    await clearPolicies();
  });

  // ─── Type Isolation ────────────────────────────────────────────────────────

  describe('type isolation', () => {
    it('URL policy does not affect exec operations', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Example URL',
          action: 'deny',
          target: 'url',
          patterns: ['example.com'],
        }),
      ]);

      // exec operation should not be affected by URL policy
      const result = await policyCheck('exec', 'example.com');
      expect(result.allowed).toBe(true);
    });

    it('command policy does not affect file_read operations', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block rm',
          action: 'deny',
          target: 'command',
          patterns: ['rm'],
        }),
      ]);

      // file_read maps to filesystem, not command
      const result = await policyCheck('file_read', 'rm');
      expect(result.allowed).toBe(true);
    });

    it('filesystem policy does not affect http_request operations', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block /etc',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/etc/**'],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://example.com/etc/shadow');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Approval Action ──────────────────────────────────────────────────────

  describe('approval action', () => {
    it('approval action is treated as deny (not allowed)', async () => {
      const policy = makePolicy({
        name: 'Require Approval',
        action: 'approval',
        target: 'url',
        patterns: ['example.com'],
      });

      await setPolicies([policy]);

      const result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(false);
      expect(result.policyId).toBe(policy.id);
      expect(result.reason).toContain('Require Approval');
    });
  });

  // ─── Empty Patterns ───────────────────────────────────────────────────────

  describe('empty patterns', () => {
    it('policy with empty patterns array matches nothing', async () => {
      await setPolicies([
        makePolicy({
          name: 'Empty Deny',
          action: 'deny',
          target: 'url',
          patterns: [],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Case Insensitivity ───────────────────────────────────────────────────

  describe('case insensitivity', () => {
    it('URL patterns are case-insensitive', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Mixed Case',
          action: 'deny',
          target: 'url',
          patterns: ['Example.COM'],
        }),
      ]);

      const result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(false);
    });
  });

  // ─── Multiple Policy Types Simultaneously ─────────────────────────────────

  describe('multiple policy types simultaneously', () => {
    it('all three policy types work together', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block Evil URL',
          action: 'deny',
          target: 'url',
          patterns: ['evil.com'],
        }),
        makePolicy({
          name: 'Block rm',
          action: 'deny',
          target: 'command',
          patterns: ['rm'],
        }),
        makePolicy({
          name: 'Block /secrets',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/secrets/**'],
        }),
      ]);

      // URL policy works
      const url = await policyCheck('http_request', 'https://evil.com');
      expect(url.allowed).toBe(false);

      // Command policy works
      const cmd = await policyCheck('exec', 'rm');
      expect(cmd.allowed).toBe(false);

      // Filesystem policy works
      const fs = await policyCheck('file_read', '/secrets/key.pem');
      expect(fs.allowed).toBe(false);

      // Non-matching targets still allowed
      const safeUrl = await policyCheck('http_request', 'https://safe.com');
      expect(safeUrl.allowed).toBe(true);

      const safeCmd = await policyCheck('exec', 'ls');
      expect(safeCmd.allowed).toBe(true);

      const safeFs = await policyCheck('file_read', '/home/user/file.txt');
      expect(safeFs.allowed).toBe(true);
    });
  });

  // ─── Policy Replacement ───────────────────────────────────────────────────

  describe('policy replacement', () => {
    it('setPolicies replaces all policies, not appends', async () => {
      // Set first policy
      await setPolicies([
        makePolicy({
          name: 'Block Example',
          action: 'deny',
          target: 'url',
          patterns: ['example.com'],
        }),
      ]);

      let result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(false);

      // Replace with different policy
      await setPolicies([
        makePolicy({
          name: 'Block Other',
          action: 'deny',
          target: 'url',
          patterns: ['other.com'],
        }),
      ]);

      // Old policy should no longer be in effect
      result = await policyCheck('http_request', 'https://example.com');
      expect(result.allowed).toBe(true);

      // New policy should be in effect
      result = await policyCheck('http_request', 'https://other.com');
      expect(result.allowed).toBe(false);
    });
  });
});
