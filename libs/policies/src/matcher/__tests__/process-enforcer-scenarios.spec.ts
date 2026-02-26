/**
 * Process enforcer scenario tests.
 *
 * Integration-style tests that validate the interplay between
 * shielded process detection and policy evaluation. These simulate
 * the process enforcer's logic:
 *   1. Check if a process is shielded → skip if so
 *   2. Evaluate remaining processes against policies
 */

import { isShieldedProcess } from '../shielded-detection';
import { matchProcessPattern } from '../process';

// ─── Helpers ─────────────────────────────────────────────────

/** Simulate the enforcer's per-process logic */
function shouldEnforce(
  command: string,
  agentUsernames: Set<string>,
  denyPatterns: string[],
  systemRe = /\b(cfprefsd|lsd|trustd|launchd|kernel_task)\b/i,
): 'skip_system' | 'skip_shielded' | 'deny' | 'allow' {
  // System process check
  if (systemRe.test(command)) return 'skip_system';

  // Shielded process check
  if (agentUsernames.size > 0 && isShieldedProcess(command, agentUsernames)) {
    return 'skip_shielded';
  }

  // Policy evaluation
  for (const pattern of denyPatterns) {
    if (matchProcessPattern(pattern, command)) {
      return 'deny';
    }
  }

  return 'allow';
}

// ─── Scenarios ───────────────────────────────────────────────

describe('process enforcer scenarios', () => {
  const agents = new Set(['ash_abc', 'ash_def']);
  const denyPatterns = ['*claude*', '*openclaw*'];

  describe('Scenario 1: Shielded claude NOT killed', () => {
    it('skips shielded claude running through guarded-shell', () => {
      const cmd =
        "sudo -H -u ash_abc /Users/ash_abc/.agenshield/bin/guarded-shell -c 'exec claude \"$@\"' -- --serve";
      expect(shouldEnforce(cmd, agents, denyPatterns)).toBe('skip_shielded');
    });

    it('skips shielded claude with combined flags', () => {
      const cmd = 'sudo -Hu ash_abc claude --dangerously-skip-permissions';
      expect(shouldEnforce(cmd, agents, denyPatterns)).toBe('skip_shielded');
    });
  });

  describe('Scenario 2: Unshielded claude IS killed', () => {
    it('denies unshielded claude binary', () => {
      const cmd = '/usr/bin/claude --serve';
      expect(shouldEnforce(cmd, agents, denyPatterns)).toBe('deny');
    });

    it('denies claude in user path', () => {
      const cmd = '/Users/david/.nvm/versions/node/v20/bin/claude';
      expect(shouldEnforce(cmd, agents, denyPatterns)).toBe('deny');
    });
  });

  describe('Scenario 3: Unknown sudo user NOT exempted', () => {
    it('evaluates against policies when sudo targets unknown user', () => {
      const cmd = 'sudo -u random_user claude --serve';
      // Not shielded (random_user not in agents), and command matches *claude*
      expect(shouldEnforce(cmd, agents, denyPatterns)).toBe('deny');
    });

    it('allows unknown sudo user if no pattern matches', () => {
      const cmd = 'sudo -u random_user vim /etc/hosts';
      expect(shouldEnforce(cmd, agents, denyPatterns)).toBe('allow');
    });
  });

  describe('Scenario 4: Multiple flag orderings all detected', () => {
    const variations = [
      'sudo -Hu ash_abc claude',
      'sudo --user=ash_abc -H claude',
      'sudo -u ash_abc -nH claude',
      'sudo -nHu ash_abc claude',
      'sudo -nHuash_abc claude',
      '/usr/bin/sudo -H -u ash_abc claude',
      'sudo --user ash_abc claude',
    ];

    for (const cmd of variations) {
      it(`detects shielded: ${cmd}`, () => {
        expect(shouldEnforce(cmd, agents, denyPatterns)).toBe('skip_shielded');
      });
    }
  });

  describe('Scenario 5: System processes still skipped', () => {
    it('skips cfprefsd', () => {
      expect(shouldEnforce('/usr/sbin/cfprefsd agent', agents, denyPatterns)).toBe('skip_system');
    });

    it('skips launchd', () => {
      expect(shouldEnforce('/sbin/launchd', agents, denyPatterns)).toBe('skip_system');
    });

    it('skips kernel_task', () => {
      expect(shouldEnforce('kernel_task', agents, denyPatterns)).toBe('skip_system');
    });
  });

  describe('Scenario 6: Allowed processes pass through', () => {
    it('allows unrelated processes', () => {
      expect(shouldEnforce('/usr/bin/vim /tmp/file.txt', agents, denyPatterns)).toBe('allow');
    });

    it('allows node server that doesnt match patterns', () => {
      expect(shouldEnforce('node /opt/myapp/server.js', agents, denyPatterns)).toBe('allow');
    });
  });

  describe('Edge: empty agent set disables shielded check', () => {
    it('denies even sudo-delegated claude when no agents configured', () => {
      const cmd = 'sudo -u ash_abc claude --serve';
      expect(shouldEnforce(cmd, new Set(), denyPatterns)).toBe('deny');
    });
  });

  describe('Edge: shielded openclaw also skipped', () => {
    it('skips shielded openclaw', () => {
      const cmd =
        "sudo -H -u ash_def /Users/ash_def/.agenshield/bin/guarded-shell -c 'exec openclaw serve'";
      expect(shouldEnforce(cmd, agents, denyPatterns)).toBe('skip_shielded');
    });
  });
});
