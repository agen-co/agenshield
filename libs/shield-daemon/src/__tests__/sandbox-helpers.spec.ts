import { extractConcreteDenyPaths, collectDenyPathsFromPolicies } from '../policy/sandbox-helpers';
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
});
