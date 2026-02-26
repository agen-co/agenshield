/**
 * Shielded detection API — unit tests
 */

import { isShieldedProcess, analyzeShieldedProcess } from '../shielded-detection';

describe('isShieldedProcess', () => {
  const agents = new Set(['ash_abc', 'ash_def']);

  it('returns true for sudo delegation to known agent user', () => {
    expect(isShieldedProcess('sudo -u ash_abc claude', agents)).toBe(true);
  });

  it('returns true for combined flags -Hu', () => {
    expect(isShieldedProcess('sudo -Hu ash_abc bash', agents)).toBe(true);
  });

  it('returns true for --user=<agent>', () => {
    expect(isShieldedProcess('sudo --user=ash_def ls', agents)).toBe(true);
  });

  it('returns true for attached -u<agent>', () => {
    expect(isShieldedProcess('sudo -uash_abc whoami', agents)).toBe(true);
  });

  it('returns false for unknown user', () => {
    expect(isShieldedProcess('sudo -u random_user claude', agents)).toBe(false);
  });

  it('returns false for non-sudo command', () => {
    expect(isShieldedProcess('/usr/bin/claude --serve', agents)).toBe(false);
  });

  it('returns false for empty agent set', () => {
    expect(isShieldedProcess('sudo -u ash_abc bash', new Set())).toBe(false);
  });

  it('returns false for sudo without -u', () => {
    expect(isShieldedProcess('sudo bash', agents)).toBe(false);
  });

  it('handles full path sudo', () => {
    expect(isShieldedProcess('/usr/bin/sudo -u ash_abc bash', agents)).toBe(true);
  });

  it('handles real-world router command', () => {
    const cmd =
      "sudo -H -u ash_abc /Users/ash_abc/.agenshield/bin/guarded-shell -c 'exec claude \"$@\"' -- --dangerously-skip-permissions";
    expect(isShieldedProcess(cmd, agents)).toBe(true);
  });
});

describe('analyzeShieldedProcess', () => {
  const agents = new Set(['ash_abc']);

  it('returns complete info for shielded process', () => {
    const cmd =
      "sudo -H -u ash_abc /Users/ash_abc/.agenshield/bin/guarded-shell -c 'exec claude'";
    const info = analyzeShieldedProcess(cmd, agents);
    expect(info).toEqual({
      isShielded: true,
      agentUser: 'ash_abc',
      usesGuardedShell: true,
      hasHostCwdMarker: false,
      effectiveCommand: 'exec claude',
    });
  });

  it('returns complete info for non-shielded process', () => {
    const info = analyzeShieldedProcess('/usr/bin/claude', agents);
    expect(info).toEqual({
      isShielded: false,
      agentUser: null,
      usesGuardedShell: false,
      hasHostCwdMarker: false,
      effectiveCommand: null,
    });
  });

  it('returns all markers when present', () => {
    const cmd =
      'sudo -H -u ash_abc /Users/ash_abc/.agenshield/bin/guarded-shell -c \'AGENSHIELD_HOST_CWD=/tmp exec claude\'';
    const info = analyzeShieldedProcess(cmd, agents);
    expect(info.isShielded).toBe(true);
    expect(info.usesGuardedShell).toBe(true);
    expect(info.hasHostCwdMarker).toBe(true);
  });
});
