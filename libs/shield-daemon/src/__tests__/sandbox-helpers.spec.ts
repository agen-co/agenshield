import { extractConcreteDenyPaths, collectDenyPathsFromPolicies, collectAllowPathsForCommand } from '../policy/sandbox-helpers';
import type { PolicyConfig } from '@agenshield/ipc';

describe('extractConcreteDenyPaths', () => {
  it('extracts absolute paths as-is', () => {
    expect(extractConcreteDenyPaths(['/etc/passwd', '/etc/shadow'])).toEqual([
      '/etc/passwd',
      '/etc/shadow',
    ]);
  });

  it('strips trailing /** suffix', () => {
    expect(extractConcreteDenyPaths(['/root/**'])).toEqual(['/root']);
  });

  it('strips trailing /* suffix', () => {
    expect(extractConcreteDenyPaths(['/etc/ssh/*'])).toEqual(['/etc/ssh']);
  });

  it('skips **/ prefixed patterns (relative globs)', () => {
    expect(extractConcreteDenyPaths(['**/.env', '**/.env.*', '**/secrets.json'])).toEqual([]);
  });

  it('skips */ prefixed patterns', () => {
    expect(extractConcreteDenyPaths(['*/config', '*/secrets'])).toEqual([]);
  });

  it('skips mid-path wildcards', () => {
    expect(extractConcreteDenyPaths(['/etc/*/config', '/var/?/data'])).toEqual([]);
  });

  it('skips non-absolute paths', () => {
    expect(extractConcreteDenyPaths(['etc/passwd', 'relative/path'])).toEqual([]);
  });

  it('skips empty strings and root-only path', () => {
    expect(extractConcreteDenyPaths(['', '  ', '/'])).toEqual([]);
  });

  it('deduplicates paths', () => {
    expect(extractConcreteDenyPaths(['/etc/passwd', '/etc/passwd', '/etc/shadow'])).toEqual([
      '/etc/passwd',
      '/etc/shadow',
    ]);
  });

  it('deduplicates after stripping suffixes', () => {
    // /root/** and /root/* both strip to /root
    expect(extractConcreteDenyPaths(['/root/**', '/root/*'])).toEqual(['/root']);
  });

  it('trims whitespace from patterns', () => {
    expect(extractConcreteDenyPaths(['  /etc/passwd  ', ' /etc/shadow '])).toEqual([
      '/etc/passwd',
      '/etc/shadow',
    ]);
  });

  it('handles the full builtin-deny-system pattern set', () => {
    const patterns = [
      '/etc/passwd',
      '/etc/shadow',
      '/etc/sudoers',
      '/etc/ssh/*',
      '/root/**',
      '/var/run/docker.sock',
    ];
    expect(extractConcreteDenyPaths(patterns)).toEqual([
      '/etc/passwd',
      '/etc/shadow',
      '/etc/sudoers',
      '/etc/ssh',
      '/root',
      '/var/run/docker.sock',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(extractConcreteDenyPaths([])).toEqual([]);
  });
});

describe('collectDenyPathsFromPolicies', () => {
  const makePolicy = (overrides: Partial<PolicyConfig>): PolicyConfig => ({
    id: 'test',
    name: 'Test Policy',
    action: 'deny',
    target: 'filesystem',
    patterns: [],
    enabled: true,
    priority: 100,
    ...overrides,
  });

  it('collects from target: filesystem deny policies', () => {
    const policies = [
      makePolicy({
        id: 'fs-deny',
        target: 'filesystem',
        action: 'deny',
        patterns: ['/etc/passwd', '/etc/shadow'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual(['/etc/passwd', '/etc/shadow']);
  });

  it('collects from target: command deny policies with file_read/file_write ops', () => {
    const policies = [
      makePolicy({
        id: 'cmd-deny-files',
        target: 'command',
        action: 'deny',
        operations: ['file_read', 'file_write'],
        patterns: ['/etc/passwd', '/etc/shadow', '/etc/sudoers'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual([
      '/etc/passwd',
      '/etc/shadow',
      '/etc/sudoers',
    ]);
  });

  it('collects from command policies with file_list ops', () => {
    const policies = [
      makePolicy({
        id: 'cmd-deny-list',
        target: 'command',
        action: 'deny',
        operations: ['file_list'],
        patterns: ['/root/**'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual(['/root']);
  });

  it('skips disabled policies', () => {
    const policies = [
      makePolicy({
        id: 'disabled',
        target: 'filesystem',
        action: 'deny',
        enabled: false,
        patterns: ['/etc/passwd'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual([]);
  });

  it('skips allow policies', () => {
    const policies = [
      makePolicy({
        id: 'allow-fs',
        target: 'filesystem',
        action: 'allow',
        patterns: ['/etc/passwd'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual([]);
  });

  it('skips command policies without file operations', () => {
    const policies = [
      makePolicy({
        id: 'cmd-exec-only',
        target: 'command',
        action: 'deny',
        operations: ['exec'],
        patterns: ['/usr/bin/rm'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual([]);
  });

  it('skips command policies with empty operations', () => {
    const policies = [
      makePolicy({
        id: 'cmd-no-ops',
        target: 'command',
        action: 'deny',
        operations: [],
        patterns: ['/etc/passwd'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual([]);
  });

  it('skips url and skill target policies', () => {
    const policies = [
      makePolicy({ id: 'url-deny', target: 'url', action: 'deny', patterns: ['https://evil.com'] }),
      makePolicy({ id: 'skill-deny', target: 'skill', action: 'deny', patterns: ['bad-skill'] }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual([]);
  });

  it('combines paths from multiple policies', () => {
    const policies = [
      makePolicy({
        id: 'fs-deny',
        target: 'filesystem',
        action: 'deny',
        patterns: ['/etc/passwd'],
      }),
      makePolicy({
        id: 'cmd-deny',
        target: 'command',
        action: 'deny',
        operations: ['file_read'],
        patterns: ['/root/**'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual(['/etc/passwd', '/root']);
  });

  it('filters out glob patterns that cannot be expressed in SBPL', () => {
    const policies = [
      makePolicy({
        id: 'secrets',
        target: 'command',
        action: 'deny',
        operations: ['file_read', 'file_write'],
        patterns: ['**/.env', '**/.env.*', '**/secrets.json', '/etc/passwd'],
      }),
    ];
    // Only /etc/passwd survives — all **/ prefixed patterns are filtered
    expect(collectDenyPathsFromPolicies(policies)).toEqual(['/etc/passwd']);
  });

  it('returns empty array for no policies', () => {
    expect(collectDenyPathsFromPolicies([])).toEqual([]);
  });

  describe('with commandBasename', () => {
    it('includes universal (no scope) deny policies', () => {
      const policies = [
        makePolicy({ id: 'global', target: 'filesystem', action: 'deny', patterns: ['/etc/passwd'] }),
      ];
      expect(collectDenyPathsFromPolicies(policies, 'curl')).toEqual(['/etc/passwd']);
    });

    it('includes matching command-scoped deny policies', () => {
      const policies = [
        makePolicy({ id: 'curl-deny', target: 'filesystem', action: 'deny', scope: 'command:curl', patterns: ['/home/secrets'] }),
      ];
      expect(collectDenyPathsFromPolicies(policies, 'curl')).toEqual(['/home/secrets']);
    });

    it('excludes non-matching command-scoped deny policies', () => {
      const policies = [
        makePolicy({ id: 'wget-deny', target: 'filesystem', action: 'deny', scope: 'command:wget', patterns: ['/home/secrets'] }),
      ];
      expect(collectDenyPathsFromPolicies(policies, 'curl')).toEqual([]);
    });

    it('combines global and matching command-scoped policies', () => {
      const policies = [
        makePolicy({ id: 'global', target: 'filesystem', action: 'deny', patterns: ['/etc/passwd'] }),
        makePolicy({ id: 'curl-deny', target: 'filesystem', action: 'deny', scope: 'command:curl', patterns: ['/home/secrets'] }),
        makePolicy({ id: 'wget-deny', target: 'filesystem', action: 'deny', scope: 'command:wget', patterns: ['/var/data'] }),
      ];
      expect(collectDenyPathsFromPolicies(policies, 'curl')).toEqual(['/etc/passwd', '/home/secrets']);
    });

    it('orders global policies before command-scoped policies', () => {
      const policies = [
        makePolicy({ id: 'curl-deny', target: 'filesystem', action: 'deny', scope: 'command:curl', patterns: ['/home/secrets'] }),
        makePolicy({ id: 'global', target: 'filesystem', action: 'deny', patterns: ['/etc/passwd'] }),
      ];
      // Global first even though command-scoped came first in array
      expect(collectDenyPathsFromPolicies(policies, 'curl')).toEqual(['/etc/passwd', '/home/secrets']);
    });

    it('backwards compat: without commandBasename, command-scoped policies are excluded', () => {
      const policies = [
        makePolicy({ id: 'global', target: 'filesystem', action: 'deny', patterns: ['/etc/passwd'] }),
        makePolicy({ id: 'curl-deny', target: 'filesystem', action: 'deny', scope: 'command:curl', patterns: ['/home/secrets'] }),
      ];
      expect(collectDenyPathsFromPolicies(policies)).toEqual(['/etc/passwd']);
    });

    it('matches command scope case-insensitively', () => {
      const policies = [
        makePolicy({ id: 'curl-deny', target: 'filesystem', action: 'deny', scope: 'command:Curl', patterns: ['/home/secrets'] }),
      ];
      expect(collectDenyPathsFromPolicies(policies, 'curl')).toEqual(['/home/secrets']);
    });
  });
});

// ---------------------------------------------------------------------------
// collectAllowPathsForCommand
// ---------------------------------------------------------------------------

describe('collectAllowPathsForCommand', () => {
  const makePolicy = (overrides: Partial<PolicyConfig>): PolicyConfig => ({
    id: 'test',
    name: 'Test Policy',
    action: 'allow',
    target: 'filesystem',
    patterns: [],
    enabled: true,
    priority: 100,
    ...overrides,
  });

  it('collects read paths from filesystem allow policy with no operations (default read)', () => {
    const policies = [
      makePolicy({ id: 'fs-allow', target: 'filesystem', action: 'allow', patterns: ['/path/to/creds'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual(['/path/to/creds']);
    expect(result.writePaths).toEqual([]);
  });

  it('collects read paths from filesystem allow policy with file_read operation', () => {
    const policies = [
      makePolicy({ id: 'fs-allow', target: 'filesystem', action: 'allow', operations: ['file_read'], patterns: ['/path/to/creds'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual(['/path/to/creds']);
    expect(result.writePaths).toEqual([]);
  });

  it('collects write paths from filesystem allow policy with file_write operation', () => {
    const policies = [
      makePolicy({ id: 'fs-allow', target: 'filesystem', action: 'allow', operations: ['file_write'], patterns: ['/tmp/output'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual([]);
    expect(result.writePaths).toEqual(['/tmp/output']);
  });

  it('collects both read and write paths when both operations specified', () => {
    const policies = [
      makePolicy({ id: 'fs-allow', target: 'filesystem', action: 'allow', operations: ['file_read', 'file_write'], patterns: ['/workspace'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual(['/workspace']);
    expect(result.writePaths).toEqual(['/workspace']);
  });

  it('collects from command target with file operations', () => {
    const policies = [
      makePolicy({ id: 'cmd-allow', target: 'command', action: 'allow', operations: ['file_read', 'file_list'], patterns: ['/config'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual(['/config']);
    expect(result.writePaths).toEqual([]);
  });

  it('excludes wrong command scope', () => {
    const policies = [
      makePolicy({ id: 'curl-allow', target: 'filesystem', action: 'allow', scope: 'command:curl', patterns: ['/tmp/curl-data'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual([]);
    expect(result.writePaths).toEqual([]);
  });

  it('includes matching command scope', () => {
    const policies = [
      makePolicy({ id: 'gog-allow', target: 'filesystem', action: 'allow', scope: 'command:gog', operations: ['file_read'], patterns: ['/path/to/creds'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual(['/path/to/creds']);
  });

  it('includes universal (no scope) policies', () => {
    const policies = [
      makePolicy({ id: 'global-allow', target: 'filesystem', action: 'allow', patterns: ['/shared/data'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual(['/shared/data']);
  });

  it('orders global before command-scoped', () => {
    const policies = [
      makePolicy({ id: 'gog-allow', target: 'filesystem', action: 'allow', scope: 'command:gog', patterns: ['/gog-specific'] }),
      makePolicy({ id: 'global-allow', target: 'filesystem', action: 'allow', patterns: ['/shared'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    // Global first even though command-scoped was first in array
    expect(result.readPaths).toEqual(['/shared', '/gog-specific']);
  });

  it('skips deny policies', () => {
    const policies = [
      makePolicy({ id: 'fs-deny', target: 'filesystem', action: 'deny', patterns: ['/etc/passwd'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual([]);
    expect(result.writePaths).toEqual([]);
  });

  it('skips disabled policies', () => {
    const policies = [
      makePolicy({ id: 'disabled', target: 'filesystem', action: 'allow', enabled: false, patterns: ['/path'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual([]);
  });

  it('skips command target without file operations', () => {
    const policies = [
      makePolicy({ id: 'cmd-exec', target: 'command', action: 'allow', operations: ['exec'], patterns: ['/usr/bin/ls'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual([]);
    expect(result.writePaths).toEqual([]);
  });

  it('returns empty for no policies', () => {
    const result = collectAllowPathsForCommand([], 'gog');
    expect(result.readPaths).toEqual([]);
    expect(result.writePaths).toEqual([]);
  });
});
