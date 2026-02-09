/**
 * E2E Test: Command Policy Enforcement
 *
 * Tests policy_check RPC for exec operations:
 * - Default behavior (fail-open)
 * - Deny/allow policies
 * - Command patterns (:* syntax)
 * - Priority ordering (deny-all + allow-specific)
 * - Enable/disable toggle
 * - Operations filter
 */

import { policyCheck, setPolicies, clearPolicies, makePolicy } from '../setup/helpers';

describe('command policy enforcement', () => {
  afterEach(async () => {
    await clearPolicies();
  });

  // ─── Default Behavior ──────────────────────────────────────────────────────

  describe('default behavior (no policies)', () => {
    it('allows any command (fail-open)', async () => {
      const result = await policyCheck('exec', 'ls');
      expect(result.allowed).toBe(true);
    });

    it('allows dangerous commands with no policies', async () => {
      const result = await policyCheck('exec', 'rm -rf /');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Deny Policies ────────────────────────────────────────────────────────

  describe('deny policies', () => {
    it('denies matching command', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block rm',
          action: 'deny',
          target: 'command',
          patterns: ['rm'],
        }),
      ]);

      const result = await policyCheck('exec', 'rm');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Block rm');
    });

    it('still allows non-matching commands', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block rm',
          action: 'deny',
          target: 'command',
          patterns: ['rm'],
        }),
      ]);

      const result = await policyCheck('exec', 'ls');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Deny-All + Allow-Specific ─────────────────────────────────────────────

  describe('deny-all + allow-specific', () => {
    it('blocks all commands except explicitly allowed', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
        makePolicy({
          name: 'Allow ls',
          action: 'allow',
          target: 'command',
          patterns: ['ls'],
          priority: 10,
        }),
      ]);

      const ls = await policyCheck('exec', 'ls');
      expect(ls.allowed).toBe(true);

      const rm = await policyCheck('exec', 'rm');
      expect(rm.allowed).toBe(false);

      const cat = await policyCheck('exec', 'cat');
      expect(cat.allowed).toBe(false);
    });
  });

  // ─── Command Patterns (:* syntax) ──────────────────────────────────────────

  describe('command patterns (:* syntax)', () => {
    it('git:* matches git, git push, git push origin main', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow git',
          action: 'allow',
          target: 'command',
          patterns: ['git:*'],
          priority: 10,
        }),
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
      ]);

      const git = await policyCheck('exec', 'git');
      expect(git.allowed).toBe(true);

      const gitPush = await policyCheck('exec', 'git push');
      expect(gitPush.allowed).toBe(true);

      const gitPushOrigin = await policyCheck('exec', 'git push origin main');
      expect(gitPushOrigin.allowed).toBe(true);
    });

    it('git:* does NOT match git-lfs (no space separator)', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow git',
          action: 'allow',
          target: 'command',
          patterns: ['git:*'],
          priority: 10,
        }),
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
      ]);

      const gitLfs = await policyCheck('exec', 'git-lfs');
      expect(gitLfs.allowed).toBe(false);
    });

    it('git push:* matches git push, git push --force origin main', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow git push',
          action: 'allow',
          target: 'command',
          patterns: ['git push:*'],
          priority: 10,
        }),
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
      ]);

      const gitPush = await policyCheck('exec', 'git push');
      expect(gitPush.allowed).toBe(true);

      const gitPushForce = await policyCheck('exec', 'git push --force origin main');
      expect(gitPushForce.allowed).toBe(true);
    });

    it('git push:* does NOT match git pull or git commit', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow git push',
          action: 'allow',
          target: 'command',
          patterns: ['git push:*'],
          priority: 10,
        }),
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
      ]);

      const gitPull = await policyCheck('exec', 'git pull');
      expect(gitPull.allowed).toBe(false);

      const gitCommit = await policyCheck('exec', 'git commit');
      expect(gitCommit.allowed).toBe(false);
    });

    it('git push (no :*) does NOT match git push origin main (exact only)', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow exact git push',
          action: 'allow',
          target: 'command',
          patterns: ['git push'],
          priority: 10,
        }),
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
      ]);

      const gitPush = await policyCheck('exec', 'git push');
      expect(gitPush.allowed).toBe(true);

      const gitPushOrigin = await policyCheck('exec', 'git push origin main');
      expect(gitPushOrigin.allowed).toBe(false);
    });

    it('yarn install (no :*) does NOT match yarn install --frozen-lockfile', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow exact yarn install',
          action: 'allow',
          target: 'command',
          patterns: ['yarn install'],
          priority: 10,
        }),
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
      ]);

      const yarnInstall = await policyCheck('exec', 'yarn install');
      expect(yarnInstall.allowed).toBe(true);

      const yarnInstallFrozen = await policyCheck('exec', 'yarn install --frozen-lockfile');
      expect(yarnInstallFrozen.allowed).toBe(false);
    });

    it('sudo -n cat:* matches sudo -n cat /etc/passwd', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow sudo cat',
          action: 'allow',
          target: 'command',
          patterns: ['sudo -n cat:*'],
          priority: 10,
        }),
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
      ]);

      const result = await policyCheck('exec', 'sudo -n cat /etc/passwd');
      expect(result.allowed).toBe(true);
    });

    it('* matches any command', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
        }),
      ]);

      const ls = await policyCheck('exec', 'ls');
      expect(ls.allowed).toBe(false);

      const git = await policyCheck('exec', 'git push origin main');
      expect(git.allowed).toBe(false);

      const node = await policyCheck('exec', 'node --version');
      expect(node.allowed).toBe(false);
    });

    it('deny * + allow git push:* → git push allowed, git commit blocked', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
        makePolicy({
          name: 'Allow git push',
          action: 'allow',
          target: 'command',
          patterns: ['git push:*'],
          priority: 10,
        }),
      ]);

      const gitPush = await policyCheck('exec', 'git push');
      expect(gitPush.allowed).toBe(true);

      const gitPushForce = await policyCheck('exec', 'git push --force');
      expect(gitPushForce.allowed).toBe(true);

      const gitCommit = await policyCheck('exec', 'git commit');
      expect(gitCommit.allowed).toBe(false);
    });

    it('curl:* matches curl with any URL', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block curl',
          action: 'deny',
          target: 'command',
          patterns: ['curl:*'],
        }),
      ]);

      const curl = await policyCheck('exec', 'curl');
      expect(curl.allowed).toBe(false);

      const curlUrl = await policyCheck('exec', 'curl https://evil.com');
      expect(curlUrl.allowed).toBe(false);
    });

    it('curl:* does NOT match curl-insecure (different command)', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block curl',
          action: 'deny',
          target: 'command',
          patterns: ['curl:*'],
        }),
      ]);

      const curlVariant = await policyCheck('exec', 'curl-insecure');
      expect(curlVariant.allowed).toBe(true);
    });
  });

  // ─── Exact match ───────────────────────────────────────────────────────────

  describe('exact match', () => {
    it('exact match for command name', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block git',
          action: 'deny',
          target: 'command',
          patterns: ['git'],
        }),
      ]);

      const git = await policyCheck('exec', 'git');
      expect(git.allowed).toBe(false);

      // git-lfs is a different command, not matched by exact "git"
      const gitLfs = await policyCheck('exec', 'git-lfs');
      expect(gitLfs.allowed).toBe(true);

      // "git push" not matched by exact "git" (no :*)
      const gitPush = await policyCheck('exec', 'git push');
      expect(gitPush.allowed).toBe(true);
    });
  });

  // ─── Priority ──────────────────────────────────────────────────────────────

  describe('priority ordering', () => {
    it('higher priority wins', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 1,
        }),
        makePolicy({
          name: 'Allow python3',
          action: 'allow',
          target: 'command',
          patterns: ['python3'],
          priority: 10,
        }),
      ]);

      const python = await policyCheck('exec', 'python3');
      expect(python.allowed).toBe(true);

      const bash = await policyCheck('exec', 'bash');
      expect(bash.allowed).toBe(false);
    });
  });

  // ─── Enable/Disable ───────────────────────────────────────────────────────

  describe('enable/disable toggle', () => {
    it('disabled deny policy allows the command', async () => {
      const policy = makePolicy({
        name: 'Block rm',
        action: 'deny',
        target: 'command',
        patterns: ['rm'],
        enabled: false,
      });

      await setPolicies([policy]);

      const result = await policyCheck('exec', 'rm');
      expect(result.allowed).toBe(true);
    });

    it('toggling enabled re-enforces the policy', async () => {
      const policy = makePolicy({
        name: 'Block rm',
        action: 'deny',
        target: 'command',
        patterns: ['rm'],
        enabled: false,
      });

      await setPolicies([policy]);
      let result = await policyCheck('exec', 'rm');
      expect(result.allowed).toBe(true);

      await setPolicies([{ ...policy, enabled: true }]);
      result = await policyCheck('exec', 'rm');
      expect(result.allowed).toBe(false);
    });
  });

  // ─── Absolute Path Normalization ──────────────────────────────────────────

  describe('absolute path normalization', () => {
    it('/usr/bin/curl:* matches /usr/bin/curl with args', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block curl',
          action: 'deny',
          target: 'command',
          patterns: ['/usr/bin/curl:*'],
        }),
      ]);

      const result = await policyCheck('exec', '/usr/bin/curl https://evil.com');
      expect(result.allowed).toBe(false);
    });

    it('/usr/bin/curl:* matches bare curl with args', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block curl',
          action: 'deny',
          target: 'command',
          patterns: ['/usr/bin/curl:*'],
        }),
      ]);

      const result = await policyCheck('exec', 'curl https://evil.com');
      expect(result.allowed).toBe(false);
    });

    it('curl:* matches /usr/bin/curl with args', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block curl',
          action: 'deny',
          target: 'command',
          patterns: ['curl:*'],
        }),
      ]);

      const result = await policyCheck('exec', '/usr/bin/curl https://evil.com');
      expect(result.allowed).toBe(false);
    });

    it('/usr/bin/curl exact matches /usr/bin/curl', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block curl exact',
          action: 'deny',
          target: 'command',
          patterns: ['/usr/bin/curl'],
        }),
      ]);

      const result = await policyCheck('exec', '/usr/bin/curl');
      expect(result.allowed).toBe(false);
    });

    it('/usr/bin/curl exact does NOT match with args (no :*)', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block curl exact',
          action: 'deny',
          target: 'command',
          patterns: ['/usr/bin/curl'],
        }),
      ]);

      const result = await policyCheck('exec', '/usr/bin/curl https://evil.com');
      expect(result.allowed).toBe(true);
    });

    it('/usr/local/bin/guarded-shell:* matches full path with args', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block guarded-shell',
          action: 'deny',
          target: 'command',
          patterns: ['/usr/local/bin/guarded-shell:*'],
        }),
      ]);

      const result = await policyCheck('exec', '/usr/local/bin/guarded-shell -c curl https://facebook.com');
      expect(result.allowed).toBe(false);
    });

    it('multiple deny patterns match absolute path target', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block dangerous',
          action: 'deny',
          target: 'command',
          patterns: ['whoami:*', 'curl:*'],
        }),
      ]);

      const result = await policyCheck('exec', '/usr/bin/curl -I https://facebook.com');
      expect(result.allowed).toBe(false);
    });

    it('deny-all + allow /usr/bin/git:* allows git push', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block All',
          action: 'deny',
          target: 'command',
          patterns: ['*'],
          priority: 0,
        }),
        makePolicy({
          name: 'Allow git',
          action: 'allow',
          target: 'command',
          patterns: ['/usr/bin/git:*'],
          priority: 10,
        }),
      ]);

      const result = await policyCheck('exec', '/usr/bin/git push');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Operations Filter ────────────────────────────────────────────────────

  describe('operations filter', () => {
    it('command policy with operations: [exec] matches exec', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block rm (exec only)',
          action: 'deny',
          target: 'command',
          patterns: ['rm'],
          operations: ['exec'],
        }),
      ]);

      const result = await policyCheck('exec', 'rm');
      expect(result.allowed).toBe(false);
    });

    it('command policy with wrong operations filter does not match', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block rm (file_read only)',
          action: 'deny',
          target: 'command',
          patterns: ['rm'],
          operations: ['file_read'],
        }),
      ]);

      const result = await policyCheck('exec', 'rm');
      expect(result.allowed).toBe(true);
    });
  });
});
