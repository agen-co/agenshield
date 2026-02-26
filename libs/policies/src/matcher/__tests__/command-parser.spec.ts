/**
 * Command parser — unit tests
 */

import {
  tokenizeCommand,
  parseSudoCommand,
  detectShieldedExecution,
} from '../command-parser';

// ─── tokenizeCommand ─────────────────────────────────────────

describe('tokenizeCommand', () => {
  it('splits on single spaces', () => {
    expect(tokenizeCommand('sudo -u alice ls -la')).toEqual([
      'sudo', '-u', 'alice', 'ls', '-la',
    ]);
  });

  it('handles multiple consecutive spaces', () => {
    expect(tokenizeCommand('sudo   -u   bob   whoami')).toEqual([
      'sudo', '-u', 'bob', 'whoami',
    ]);
  });

  it('handles tabs', () => {
    expect(tokenizeCommand("sudo\t-u\talice\tls")).toEqual([
      'sudo', '-u', 'alice', 'ls',
    ]);
  });

  it('handles single-quoted strings', () => {
    expect(tokenizeCommand("sh -c 'echo hello world'")).toEqual([
      'sh', '-c', 'echo hello world',
    ]);
  });

  it('handles double-quoted strings', () => {
    expect(tokenizeCommand('sh -c "echo hello world"')).toEqual([
      'sh', '-c', 'echo hello world',
    ]);
  });

  it('handles escaped chars in double quotes', () => {
    expect(tokenizeCommand('sh -c "echo \\"hello\\""')).toEqual([
      'sh', '-c', 'echo "hello"',
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(tokenizeCommand('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(tokenizeCommand('   ')).toEqual([]);
  });

  it('handles single token', () => {
    expect(tokenizeCommand('ls')).toEqual(['ls']);
  });

  it('handles leading and trailing whitespace', () => {
    expect(tokenizeCommand('  sudo -u alice  ')).toEqual([
      'sudo', '-u', 'alice',
    ]);
  });

  it('handles mixed quoting', () => {
    expect(tokenizeCommand("sudo sh -c 'exec claude \"--flag\"'")).toEqual([
      'sudo', 'sh', '-c', 'exec claude "--flag"',
    ]);
  });

  it('handles unclosed quote gracefully (truncated ps output)', () => {
    // Truncated ps output may cut off mid-quote
    const tokens = tokenizeCommand("sh -c 'echo hello");
    expect(tokens).toEqual(['sh', '-c', 'echo hello']);
  });
});

// ─── parseSudoCommand ────────────────────────────────────────

describe('parseSudoCommand', () => {
  it('returns null for empty tokens', () => {
    expect(parseSudoCommand([])).toBeNull();
  });

  it('returns null for non-sudo command', () => {
    expect(parseSudoCommand(['ls', '-la'])).toBeNull();
  });

  it('returns null for command that contains sudo but doesnt start with it', () => {
    expect(parseSudoCommand(['nosudo', '-u', 'alice'])).toBeNull();
  });

  describe('-u <user> (space-separated)', () => {
    it('parses -u alice command', () => {
      const result = parseSudoCommand(['sudo', '-u', 'alice', 'ls', '-la']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: 'ls -la',
        innerTokens: ['ls', '-la'],
      });
    });
  });

  describe('-u<user> (attached)', () => {
    it('parses -ualice command', () => {
      const result = parseSudoCommand(['sudo', '-ualice', 'whoami']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: 'whoami',
        innerTokens: ['whoami'],
      });
    });
  });

  describe('-Hu <user> (combined flags with value)', () => {
    it('parses -Hu alice', () => {
      const result = parseSudoCommand(['sudo', '-Hu', 'alice', 'bash']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: true,
        innerCommand: 'bash',
        innerTokens: ['bash'],
      });
    });
  });

  describe('-nHu<user> (combined flags with attached value)', () => {
    it('parses -nHualice', () => {
      const result = parseSudoCommand(['sudo', '-nHualice', 'whoami']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: true,
        innerCommand: 'whoami',
        innerTokens: ['whoami'],
      });
    });
  });

  describe('-H -u <user> (separate flags)', () => {
    it('parses -H -u alice', () => {
      const result = parseSudoCommand(['sudo', '-H', '-u', 'alice', 'ls']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: true,
        innerCommand: 'ls',
        innerTokens: ['ls'],
      });
    });
  });

  describe('--user=<user> (long form with =)', () => {
    it('parses --user=alice', () => {
      const result = parseSudoCommand(['sudo', '--user=alice', 'whoami']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: 'whoami',
        innerTokens: ['whoami'],
      });
    });
  });

  describe('--user <user> (long form with space)', () => {
    it('parses --user alice', () => {
      const result = parseSudoCommand(['sudo', '--user', 'alice', 'bash']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: 'bash',
        innerTokens: ['bash'],
      });
    });
  });

  describe('-- separator', () => {
    it('stops flag parsing at --', () => {
      const result = parseSudoCommand(['sudo', '-u', 'alice', '--', '-flag-like-arg']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: '-flag-like-arg',
        innerTokens: ['-flag-like-arg'],
      });
    });
  });

  describe('value-consuming flags', () => {
    it('handles -g flag consuming next token', () => {
      const result = parseSudoCommand(['sudo', '-g', 'staff', '-u', 'alice', 'ls']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: 'ls',
        innerTokens: ['ls'],
      });
    });

    it('handles -C flag consuming attached value', () => {
      const result = parseSudoCommand(['sudo', '-C5', '-u', 'alice', 'cmd']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: 'cmd',
        innerTokens: ['cmd'],
      });
    });
  });

  describe('full path sudo', () => {
    it('handles /usr/bin/sudo', () => {
      const result = parseSudoCommand(['/usr/bin/sudo', '-u', 'alice', 'ls']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: 'ls',
        innerTokens: ['ls'],
      });
    });

    it('handles /usr/local/bin/sudo', () => {
      const result = parseSudoCommand(['/usr/local/bin/sudo', '-Hu', 'bob', 'bash']);
      expect(result).toEqual({
        targetUser: 'bob',
        setHome: true,
        innerCommand: 'bash',
        innerTokens: ['bash'],
      });
    });
  });

  describe('no inner command', () => {
    it('handles sudo with flags but no command', () => {
      const result = parseSudoCommand(['sudo', '-u', 'alice']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: '',
        innerTokens: [],
      });
    });
  });

  describe('sudo without -u', () => {
    it('returns null targetUser when no -u is specified', () => {
      const result = parseSudoCommand(['sudo', '-H', 'bash']);
      expect(result).toEqual({
        targetUser: null,
        setHome: true,
        innerCommand: 'bash',
        innerTokens: ['bash'],
      });
    });
  });

  describe('truncated input', () => {
    it('handles truncated -u at end', () => {
      const result = parseSudoCommand(['sudo', '-u']);
      expect(result).toEqual({
        targetUser: null,
        setHome: false,
        innerCommand: '',
        innerTokens: [],
      });
    });
  });

  describe('long options other than --user', () => {
    it('skips --preserve-env and continues', () => {
      const result = parseSudoCommand(['sudo', '--preserve-env', '-u', 'alice', 'cmd']);
      expect(result).toEqual({
        targetUser: 'alice',
        setHome: false,
        innerCommand: 'cmd',
        innerTokens: ['cmd'],
      });
    });
  });
});

// ─── detectShieldedExecution ─────────────────────────────────

describe('detectShieldedExecution', () => {
  const agents = new Set(['ash_abc', 'ash_def']);

  describe('full shielded chain (sudo → guarded-shell → command)', () => {
    it('detects shielded execution with guarded-shell', () => {
      const cmd =
        "sudo -H -u ash_abc /Users/ash_abc/.agenshield/bin/guarded-shell -c 'exec claude \"$@\"' -- --serve";
      const info = detectShieldedExecution(cmd, agents);
      expect(info.isShielded).toBe(true);
      expect(info.agentUser).toBe('ash_abc');
      expect(info.usesGuardedShell).toBe(true);
      expect(info.effectiveCommand).toBe('exec claude "$@"');
    });
  });

  describe('fallback chain (sudo → env → command)', () => {
    it('detects shielded execution with AGENSHIELD_HOST_CWD', () => {
      const cmd =
        'sudo -H -u ash_abc env AGENSHIELD_HOST_CWD=/Users/david/project claude --serve';
      const info = detectShieldedExecution(cmd, agents);
      expect(info.isShielded).toBe(true);
      expect(info.agentUser).toBe('ash_abc');
      expect(info.hasHostCwdMarker).toBe(true);
    });
  });

  describe('basic delegation without markers', () => {
    it('detects shielded execution with just sudo -u', () => {
      const cmd = 'sudo -u ash_def claude --serve';
      const info = detectShieldedExecution(cmd, agents);
      expect(info.isShielded).toBe(true);
      expect(info.agentUser).toBe('ash_def');
      expect(info.usesGuardedShell).toBe(false);
      expect(info.hasHostCwdMarker).toBe(false);
    });
  });

  describe('unknown agent user', () => {
    it('is not shielded when user is not in agent set', () => {
      const cmd = 'sudo -u random_user claude --serve';
      const info = detectShieldedExecution(cmd, agents);
      expect(info.isShielded).toBe(false);
      expect(info.agentUser).toBe('random_user');
    });
  });

  describe('non-sudo command', () => {
    it('is not shielded', () => {
      const cmd = '/usr/bin/claude --serve';
      const info = detectShieldedExecution(cmd, agents);
      expect(info.isShielded).toBe(false);
      expect(info.agentUser).toBeNull();
    });
  });

  describe('guarded-shell marker detection', () => {
    it('detects marker in command', () => {
      const cmd =
        "sudo -Hu ash_abc /Users/ash_abc/.agenshield/bin/guarded-shell -c 'claude'";
      const info = detectShieldedExecution(cmd, agents);
      expect(info.usesGuardedShell).toBe(true);
    });

    it('does not false-positive on unrelated commands', () => {
      const cmd = 'sudo -u ash_abc bash -c "echo hello"';
      const info = detectShieldedExecution(cmd, agents);
      expect(info.usesGuardedShell).toBe(false);
    });
  });

  describe('HOST_CWD marker detection', () => {
    it('detects AGENSHIELD_HOST_CWD in command', () => {
      const cmd =
        'sudo -u ash_abc env AGENSHIELD_HOST_CWD=/tmp /bin/sh -c "ls"';
      const info = detectShieldedExecution(cmd, agents);
      expect(info.hasHostCwdMarker).toBe(true);
    });
  });

  describe('real-world ps output from router wrapper', () => {
    it('handles the exact router execution chain', () => {
      const cmd =
        "sudo -H -u ash_abc /Users/ash_abc/.agenshield/bin/guarded-shell -c 'exec claude \"$@\"' -- --dangerously-skip-permissions";
      const info = detectShieldedExecution(cmd, agents);
      expect(info).toEqual({
        isShielded: true,
        agentUser: 'ash_abc',
        usesGuardedShell: true,
        hasHostCwdMarker: false,
        effectiveCommand: 'exec claude "$@"',
      });
    });
  });

  describe('combined sudo flags', () => {
    it('handles -Hu<user>', () => {
      const cmd = 'sudo -Huash_abc /some/command';
      const info = detectShieldedExecution(cmd, agents);
      expect(info.isShielded).toBe(true);
      expect(info.agentUser).toBe('ash_abc');
    });

    it('handles -nHu <user>', () => {
      const cmd = 'sudo -nHu ash_abc /some/command';
      const info = detectShieldedExecution(cmd, agents);
      expect(info.isShielded).toBe(true);
      expect(info.agentUser).toBe('ash_abc');
    });

    it('handles --user=ash_abc -H', () => {
      const cmd = 'sudo --user=ash_abc -H bash';
      const info = detectShieldedExecution(cmd, agents);
      expect(info.isShielded).toBe(true);
      expect(info.agentUser).toBe('ash_abc');
    });
  });

  describe('truncated ps output', () => {
    it('handles truncated command gracefully', () => {
      // ps output can be truncated — parser should not crash
      const cmd = "sudo -H -u ash_abc /Users/ash_abc/.agenshield/bin/guarded-shell -c 'exec clau";
      const info = detectShieldedExecution(cmd, agents);
      expect(info.isShielded).toBe(true);
      expect(info.agentUser).toBe('ash_abc');
      expect(info.usesGuardedShell).toBe(true);
    });
  });

  describe('empty agent set', () => {
    it('is never shielded with empty agent set', () => {
      const cmd = 'sudo -u ash_abc bash';
      const info = detectShieldedExecution(cmd, new Set());
      expect(info.isShielded).toBe(false);
    });
  });
});
