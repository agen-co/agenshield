/**
 * E2E Test: Filesystem Policy Enforcement
 *
 * Tests policy_check RPC for file_read, file_write, file_list operations:
 * - Default behavior (fail-open)
 * - Deny policies for specific paths
 * - Glob patterns
 * - Operations filter (write vs read on same path)
 * - Deny-all + allow-specific directory
 * - Enable/disable toggle
 */

import { policyCheck, setPolicies, clearPolicies, makePolicy } from '../setup/helpers';

describe('filesystem policy enforcement', () => {
  afterEach(async () => {
    await clearPolicies();
  });

  // ─── Default Behavior ──────────────────────────────────────────────────────

  describe('default behavior (no policies)', () => {
    it('allows file_read (fail-open)', async () => {
      const result = await policyCheck('file_read', '/etc/passwd');
      expect(result.allowed).toBe(true);
    });

    it('allows file_write (fail-open)', async () => {
      const result = await policyCheck('file_write', '/tmp/test.txt');
      expect(result.allowed).toBe(true);
    });

    it('allows file_list (fail-open)', async () => {
      const result = await policyCheck('file_list', '/home');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Deny Policies ────────────────────────────────────────────────────────

  describe('deny policies', () => {
    it('denies exact path match', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block shadow',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/etc/shadow'],
        }),
      ]);

      const result = await policyCheck('file_read', '/etc/shadow');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Block shadow');
    });

    it('still allows non-matching paths', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block shadow',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/etc/shadow'],
        }),
      ]);

      const result = await policyCheck('file_read', '/etc/hosts');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Glob Patterns ────────────────────────────────────────────────────────

  describe('glob patterns', () => {
    it('** matches across directories', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block all .env files',
          action: 'deny',
          target: 'filesystem',
          patterns: ['**/.env'],
        }),
      ]);

      const r1 = await policyCheck('file_read', '/project/.env');
      expect(r1.allowed).toBe(false);

      const r2 = await policyCheck('file_read', '/a/b/c/.env');
      expect(r2.allowed).toBe(false);
    });

    it('* matches within a single directory', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block tmp logs',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/tmp/*.log'],
        }),
      ]);

      const match = await policyCheck('file_read', '/tmp/app.log');
      expect(match.allowed).toBe(false);

      const noMatch = await policyCheck('file_read', '/tmp/sub/app.log');
      expect(noMatch.allowed).toBe(true);
    });

    it('directory glob with **', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block home dir',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/home/user/**'],
        }),
      ]);

      const result = await policyCheck('file_read', '/home/user/documents/file.txt');
      expect(result.allowed).toBe(false);
    });
  });

  // ─── Operations Filter ────────────────────────────────────────────────────

  describe('operations filter', () => {
    it('deny file_write but allow file_read on same path', async () => {
      await setPolicies([
        makePolicy({
          name: 'No Writing Secrets',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/secrets/**'],
          operations: ['file_write'],
        }),
      ]);

      const write = await policyCheck('file_write', '/secrets/key.pem');
      expect(write.allowed).toBe(false);

      const read = await policyCheck('file_read', '/secrets/key.pem');
      expect(read.allowed).toBe(true);

      const list = await policyCheck('file_list', '/secrets/');
      expect(list.allowed).toBe(true);
    });

    it('deny file_read and file_list but allow file_write', async () => {
      await setPolicies([
        makePolicy({
          name: 'Write-only log dir',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/var/log/**'],
          operations: ['file_read', 'file_list'],
        }),
      ]);

      const read = await policyCheck('file_read', '/var/log/syslog');
      expect(read.allowed).toBe(false);

      const list = await policyCheck('file_list', '/var/log/');
      expect(list.allowed).toBe(false);

      const write = await policyCheck('file_write', '/var/log/app.log');
      expect(write.allowed).toBe(true);
    });
  });

  // ─── Deny-All + Allow-Specific ─────────────────────────────────────────────

  describe('deny-all + allow-specific', () => {
    it('blocks all filesystem access except allowed directory', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block All Files',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/**'],
          priority: 0,
        }),
        makePolicy({
          name: 'Allow Agent Home',
          action: 'allow',
          target: 'filesystem',
          patterns: ['/home/agent/**'],
          priority: 10,
        }),
      ]);

      const allowed = await policyCheck('file_read', '/home/agent/data.txt');
      expect(allowed.allowed).toBe(true);

      const denied = await policyCheck('file_read', '/etc/passwd');
      expect(denied.allowed).toBe(false);
    });
  });

  // ─── Enable/Disable ───────────────────────────────────────────────────────

  describe('enable/disable toggle', () => {
    it('disabled deny policy allows access', async () => {
      const policy = makePolicy({
        name: 'Block secrets',
        action: 'deny',
        target: 'filesystem',
        patterns: ['/secrets/**'],
        enabled: false,
      });

      await setPolicies([policy]);

      const result = await policyCheck('file_read', '/secrets/key.pem');
      expect(result.allowed).toBe(true);
    });

    it('toggling enabled re-enforces the policy', async () => {
      const policy = makePolicy({
        name: 'Block secrets',
        action: 'deny',
        target: 'filesystem',
        patterns: ['/secrets/**'],
        enabled: false,
      });

      await setPolicies([policy]);
      let result = await policyCheck('file_read', '/secrets/key.pem');
      expect(result.allowed).toBe(true);

      await setPolicies([{ ...policy, enabled: true }]);
      result = await policyCheck('file_read', '/secrets/key.pem');
      expect(result.allowed).toBe(false);
    });
  });

  // ─── All Three Operations ──────────────────────────────────────────────────

  describe('all three operations', () => {
    it('deny policy without operations filter blocks all file operations', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block everything in /private',
          action: 'deny',
          target: 'filesystem',
          patterns: ['/private/**'],
        }),
      ]);

      const read = await policyCheck('file_read', '/private/data.txt');
      expect(read.allowed).toBe(false);

      const write = await policyCheck('file_write', '/private/data.txt');
      expect(write.allowed).toBe(false);

      const list = await policyCheck('file_list', '/private/');
      expect(list.allowed).toBe(false);
    });
  });
});
