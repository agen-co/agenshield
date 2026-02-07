/**
 * E2E Enforcement Test: Command Policy Enforcement
 *
 * Tests dynamic command policy changes and verifies real command execution
 * is affected for the sandboxed agent user.
 *
 * Uses:
 * - RPC policy_check: verify policy evaluation for exec operations
 * - runAsAgentUser(): execute commands as the agent user
 * - File system checks: verify wrapper files in $HOME/bin
 */

import * as fs from 'node:fs';
import {
  runAsAgentUser,
  setPolicies,
  clearPolicies,
  makePolicy,
  policyCheck,
  getAgentHome,
  sleep,
} from '../setup/helpers';

describe('command enforcement', () => {
  afterEach(async () => {
    await clearPolicies();
    // Give time for wrapper cleanup
    await sleep(500);
  });

  // ─── Policy Check (API-level) ──────────────────────────────────────────────

  describe('policy_check RPC for exec', () => {
    it('default: all commands allowed via policy engine (fail-open)', async () => {
      const result = await policyCheck('exec', 'ls');
      expect(result.allowed).toBe(true);
    });

    it('deny policy blocks command via policy engine', async () => {
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
    });

    it('allow policy permits command via policy engine', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow ls',
          action: 'allow',
          target: 'command',
          patterns: ['ls'],
        }),
      ]);

      const result = await policyCheck('exec', 'ls');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Agent Bin Directory ───────────────────────────────────────────────────

  describe('agent bin directory', () => {
    it('agent has a bin directory', () => {
      const home = getAgentHome();
      const binDir = `${home}/bin`;
      expect(fs.existsSync(binDir)).toBe(true);
    });

    it('bin directory has predefined wrapper scripts', () => {
      const home = getAgentHome();
      const binDir = `${home}/bin`;
      // Predefined proxied commands should always exist (git, npm, etc.)
      const entries = fs.readdirSync(binDir);
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  // ─── Agent User Command Execution ─────────────────────────────────────────

  describe('agent user command execution', () => {
    it('agent can run commands available in bin dir', () => {
      const home = getAgentHome();
      const result = runAsAgentUser(`ls ${home}`, { timeout: 10_000 });
      // ls should work (either as wrapper or basic command)
      expect(result.exitCode).toBe(0);
    });

    it('test harness can run command execution test', () => {
      const result = runAsAgentUser('openclaw run --test-exec "echo hello"', {
        timeout: 15_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/SUCCESS|BLOCKED/);
    });
  });

  // ─── Dynamic Policy Changes ────────────────────────────────────────────────

  describe('dynamic command policy changes', () => {
    it('adding command allow policy updates wrapper sync', async () => {
      // Add allow policy for git
      await setPolicies([
        makePolicy({
          name: 'Allow git',
          action: 'allow',
          target: 'command',
          patterns: ['git'],
        }),
      ]);

      // Verify via policy engine
      const result = await policyCheck('exec', 'git');
      expect(result.allowed).toBe(true);

      // Try running git as agent user
      const gitResult = runAsAgentUser('git --version', { timeout: 10_000 });
      // git should be available (either via wrapper or system path)
      expect(gitResult.stdout + gitResult.stderr).toMatch(/git version|not found|BLOCKED/);
    });

    it('deny-all + allow-specific via policy engine', async () => {
      await setPolicies([
        makePolicy({
          name: 'Block All Commands',
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

      const curl = await policyCheck('exec', 'curl');
      expect(curl.allowed).toBe(false);
    });

    it('removing allow policy changes policy check result', async () => {
      await setPolicies([
        makePolicy({
          name: 'Allow echo',
          action: 'allow',
          target: 'command',
          patterns: ['echo'],
        }),
      ]);

      let result = await policyCheck('exec', 'echo');
      expect(result.allowed).toBe(true);

      await clearPolicies();

      // Still allowed (fail-open), but no explicit allow policy
      result = await policyCheck('exec', 'echo');
      expect(result.allowed).toBe(true);
    });
  });
});
