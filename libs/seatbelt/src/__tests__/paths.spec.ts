import { extractConcreteDenyPaths, collectDenyPathsFromPolicies, collectAllowPathsForCommand } from '../paths';
import type { PolicyConfig } from '@agenshield/ipc';

describe('extractConcreteDenyPaths', () => {
  it('extracts absolute paths', () => {
    expect(extractConcreteDenyPaths(['/etc/ssh', '/var/secrets'])).toEqual(['/etc/ssh', '/var/secrets']);
  });

  it('strips trailing /* and /**', () => {
    expect(extractConcreteDenyPaths(['/etc/ssh/*', '/var/secrets/**'])).toEqual(['/etc/ssh', '/var/secrets']);
  });

  it('skips relative glob patterns', () => {
    expect(extractConcreteDenyPaths(['**/.env', '*/.git'])).toEqual([]);
  });

  it('skips non-absolute paths', () => {
    expect(extractConcreteDenyPaths(['foo/bar', 'relative/path'])).toEqual([]);
  });

  it('skips paths with remaining wildcards', () => {
    expect(extractConcreteDenyPaths(['/etc/*/config'])).toEqual([]);
  });

  it('skips root-only paths', () => {
    expect(extractConcreteDenyPaths(['/', ''])).toEqual([]);
  });

  it('deduplicates', () => {
    expect(extractConcreteDenyPaths(['/etc/ssh', '/etc/ssh'])).toEqual(['/etc/ssh']);
  });
});

describe('collectDenyPathsFromPolicies', () => {
  const mkPolicy = (overrides: Partial<PolicyConfig>): PolicyConfig => ({
    id: 'test',
    name: 'test',
    action: 'deny',
    target: 'filesystem',
    patterns: [],
    enabled: true,
    priority: 0,
    ...overrides,
  });

  it('collects filesystem deny paths', () => {
    const policies = [
      mkPolicy({ patterns: ['/etc/ssh', '/var/secrets'] }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual(['/etc/ssh', '/var/secrets']);
  });

  it('skips allow policies', () => {
    const policies = [
      mkPolicy({ action: 'allow', patterns: ['/etc/ssh'] }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual([]);
  });

  it('skips disabled policies', () => {
    const policies = [
      mkPolicy({ enabled: false, patterns: ['/etc/ssh'] }),
    ];
    expect(collectDenyPathsFromPolicies(policies)).toEqual([]);
  });

  it('includes command-scoped policies when commandBasename matches', () => {
    const policies = [
      mkPolicy({
        target: 'command',
        scope: 'command:curl',
        operations: ['file_read'],
        patterns: ['/etc/ssl'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies, 'curl')).toEqual(['/etc/ssl']);
  });

  it('excludes command-scoped policies when commandBasename does not match', () => {
    const policies = [
      mkPolicy({
        target: 'command',
        scope: 'command:curl',
        operations: ['file_read'],
        patterns: ['/etc/ssl'],
      }),
    ];
    expect(collectDenyPathsFromPolicies(policies, 'wget')).toEqual([]);
  });
});

describe('collectAllowPathsForCommand', () => {
  const mkPolicy = (overrides: Partial<PolicyConfig>): PolicyConfig => ({
    id: 'test',
    name: 'test',
    action: 'allow',
    target: 'filesystem',
    patterns: [],
    enabled: true,
    priority: 0,
    ...overrides,
  });

  it('separates read and write paths', () => {
    const policies = [
      mkPolicy({ operations: ['file_read'], patterns: ['/data/read'] }),
      mkPolicy({ operations: ['file_write'], patterns: ['/data/write'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual(['/data/read']);
    expect(result.writePaths).toEqual(['/data/write']);
  });

  it('defaults to read paths when operations empty', () => {
    const policies = [
      mkPolicy({ operations: [], patterns: ['/data/default'] }),
    ];
    const result = collectAllowPathsForCommand(policies, 'gog');
    expect(result.readPaths).toEqual(['/data/default']);
    expect(result.writePaths).toEqual([]);
  });
});
