import { stripGlobToBasePath, operationsToAclPerms, computeAclMap, isFilesystemRelevant } from '../acl';
import type { PolicyConfig } from '@agenshield/ipc';

const makePolicy = (overrides: Partial<PolicyConfig>): PolicyConfig => ({
  id: 'test',
  name: 'Test Policy',
  action: 'allow',
  target: 'filesystem',
  patterns: [],
  enabled: true,
  priority: 100,
  operations: [],
  ...overrides,
});

describe('stripGlobToBasePath', () => {
  it('strips trailing /** from path', () => {
    expect(stripGlobToBasePath('/root/**')).toBe('/root');
  });

  it('strips trailing /* from path', () => {
    expect(stripGlobToBasePath('/etc/ssh/*')).toBe('/etc/ssh');
  });

  it('returns the path unchanged when no globs', () => {
    expect(stripGlobToBasePath('/etc/passwd')).toBe('/etc/passwd');
  });

  it('returns / for root glob patterns', () => {
    expect(stripGlobToBasePath('/*')).toBe('/');
  });

  it('expands ~ to home directory', () => {
    const result = stripGlobToBasePath('~/docs/**');
    expect(result).not.toContain('~');
    expect(result).toMatch(/\/docs$/);
  });
});

describe('operationsToAclPerms', () => {
  it('returns read permissions for file_read', () => {
    const perms = operationsToAclPerms(['file_read']);
    expect(perms).toContain('read');
    expect(perms).toContain('readattr');
    expect(perms).toContain('search');
  });

  it('returns write permissions for file_write', () => {
    const perms = operationsToAclPerms(['file_write']);
    expect(perms).toContain('write');
    expect(perms).toContain('append');
  });

  it('returns combined permissions for both ops', () => {
    const perms = operationsToAclPerms(['file_read', 'file_write']);
    expect(perms).toContain('read');
    expect(perms).toContain('write');
  });

  it('returns empty string for empty operations', () => {
    expect(operationsToAclPerms([])).toBe('');
  });

  it('returns empty string for non-file operations', () => {
    expect(operationsToAclPerms(['exec'])).toBe('');
  });
});

describe('isFilesystemRelevant', () => {
  it('returns true for target: filesystem', () => {
    expect(isFilesystemRelevant(makePolicy({ target: 'filesystem' }))).toBe(true);
  });

  it('returns true for target: command with file_read', () => {
    expect(isFilesystemRelevant(makePolicy({
      target: 'command',
      operations: ['file_read'],
    }))).toBe(true);
  });

  it('returns true for target: command with file_write', () => {
    expect(isFilesystemRelevant(makePolicy({
      target: 'command',
      operations: ['file_write'],
    }))).toBe(true);
  });

  it('returns true for target: command with file_list', () => {
    expect(isFilesystemRelevant(makePolicy({
      target: 'command',
      operations: ['file_list'],
    }))).toBe(true);
  });

  it('returns false for target: command with only exec', () => {
    expect(isFilesystemRelevant(makePolicy({
      target: 'command',
      operations: ['exec'],
    }))).toBe(false);
  });

  it('returns false for target: command with no operations', () => {
    expect(isFilesystemRelevant(makePolicy({
      target: 'command',
      operations: [],
    }))).toBe(false);
  });

  it('returns false for target: url', () => {
    expect(isFilesystemRelevant(makePolicy({ target: 'url' }))).toBe(false);
  });

  it('returns false for target: skill', () => {
    expect(isFilesystemRelevant(makePolicy({ target: 'skill' }))).toBe(false);
  });
});

describe('computeAclMap', () => {
  it('returns allow map entries for allow policies', () => {
    const policies = [
      makePolicy({
        action: 'allow',
        target: 'filesystem',
        operations: ['file_read'],
        patterns: ['/Users/me/docs/**'],
      }),
    ];
    const { allow, deny } = computeAclMap(policies);
    expect(allow.has('/Users/me/docs')).toBe(true);
    expect(allow.get('/Users/me/docs')).toContain('read');
    expect(deny.size).toBe(0);
  });

  it('returns deny map entries for deny policies', () => {
    const policies = [
      makePolicy({
        action: 'deny',
        target: 'filesystem',
        operations: ['file_read', 'file_write'],
        patterns: ['/etc/passwd'],
      }),
    ];
    const { allow, deny } = computeAclMap(policies);
    expect(deny.has('/etc/passwd')).toBe(true);
    expect(deny.get('/etc/passwd')).toContain('read');
    expect(deny.get('/etc/passwd')).toContain('write');
    expect(allow.size).toBe(0);
  });

  it('merges permissions from multiple allow policies on same path', () => {
    const policies = [
      makePolicy({
        id: 'p1',
        action: 'allow',
        operations: ['file_read'],
        patterns: ['/data'],
      }),
      makePolicy({
        id: 'p2',
        action: 'allow',
        operations: ['file_write'],
        patterns: ['/data'],
      }),
    ];
    const { allow } = computeAclMap(policies);
    const perms = allow.get('/data')!;
    expect(perms).toContain('read');
    expect(perms).toContain('write');
  });

  it('adds traversal ancestors for allow entries', () => {
    const policies = [
      makePolicy({
        action: 'allow',
        operations: ['file_read'],
        patterns: ['/Users/me/projects/data/**'],
      }),
    ];
    const { allow } = computeAclMap(policies);
    // /Users/me and /Users/me/projects should get traversal (search) perms
    // but /Users is world-traversable, so only me and projects
    expect(allow.has('/Users/me')).toBe(true);
    expect(allow.get('/Users/me')).toBe('search');
    expect(allow.has('/Users/me/projects')).toBe(true);
    expect(allow.get('/Users/me/projects')).toBe('search');
  });

  it('does NOT add traversal ancestors for deny entries', () => {
    const policies = [
      makePolicy({
        action: 'deny',
        operations: ['file_read'],
        patterns: ['/Users/me/secrets/file.txt'],
      }),
    ];
    const { deny } = computeAclMap(policies);
    // Only the direct target should be in the deny map
    expect(deny.has('/Users/me/secrets/file.txt')).toBe(true);
    expect(deny.has('/Users/me/secrets')).toBe(false);
    expect(deny.has('/Users/me')).toBe(false);
  });

  it('skips policies with empty operations', () => {
    const policies = [
      makePolicy({
        action: 'allow',
        operations: [],
        patterns: ['/data'],
      }),
    ];
    const { allow, deny } = computeAclMap(policies);
    expect(allow.size).toBe(0);
    expect(deny.size).toBe(0);
  });

  it('handles both allow and deny policies together', () => {
    const policies = [
      makePolicy({
        id: 'allow-docs',
        action: 'allow',
        operations: ['file_read', 'file_write'],
        patterns: ['/Users/me/docs/**'],
      }),
      makePolicy({
        id: 'deny-system',
        action: 'deny',
        operations: ['file_read'],
        patterns: ['/etc/passwd', '/etc/shadow'],
      }),
    ];
    const { allow, deny } = computeAclMap(policies);
    expect(allow.has('/Users/me/docs')).toBe(true);
    expect(deny.has('/etc/passwd')).toBe(true);
    expect(deny.has('/etc/shadow')).toBe(true);
  });

  it('strips globs from deny patterns', () => {
    const policies = [
      makePolicy({
        action: 'deny',
        operations: ['file_read'],
        patterns: ['/root/**', '/etc/ssh/*'],
      }),
    ];
    const { deny } = computeAclMap(policies);
    expect(deny.has('/root')).toBe(true);
    expect(deny.has('/etc/ssh')).toBe(true);
  });
});
