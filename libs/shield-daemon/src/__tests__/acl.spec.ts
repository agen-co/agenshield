import { stripGlobToBasePath, operationsToAclPerms, computeAclMap, isFilesystemRelevant, addUserAcl, removeUserAcl, removeAllUserAcls } from '../acl';
import type { PolicyConfig } from '@agenshield/ipc';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn(),
}));

jest.mock('../config/paths', () => ({
  isDevMode: () => false,
}));

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

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

describe('addUserAcl (idempotency)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('skips chmod when ACL entry already exists with matching permissions', () => {
    // ls -le returns an existing entry that covers the requested permissions
    mockExecSync.mockReturnValueOnce(
      'total 0\n 0: user:ash_agent allow read,readattr,readextattr,list,search,execute\n' as never,
    );

    addUserAcl('/Users/me/docs', 'ash_agent', 'search', undefined, 'allow');

    // Should only have called ls -le (for hasUserAcl check), no chmod
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('ls -le'),
      expect.any(Object),
    );
  });

  it('proceeds with chmod when no matching ACL entry exists', () => {
    // ls -le returns empty (no ACLs)
    mockExecSync.mockReturnValueOnce('total 0\n' as never);
    // chmod succeeds
    mockExecSync.mockReturnValueOnce('' as never);

    addUserAcl('/Users/me/docs', 'ash_agent', 'search', undefined, 'allow');

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('chmod +a'),
      expect.any(Object),
    );
  });

  it('proceeds when existing entry has insufficient permissions', () => {
    // Existing entry only has 'search', but we request 'read,search'
    mockExecSync.mockReturnValueOnce(
      'total 0\n 0: user:ash_agent allow search\n' as never,
    );
    mockExecSync.mockReturnValueOnce('' as never);

    addUserAcl('/Users/me/docs', 'ash_agent', 'read,search', undefined, 'allow');

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('chmod +a'),
      expect.any(Object),
    );
  });

  it('does not match different action type (allow vs deny)', () => {
    mockExecSync.mockReturnValueOnce(
      'total 0\n 0: user:ash_agent allow search\n' as never,
    );
    mockExecSync.mockReturnValueOnce('' as never);

    addUserAcl('/Users/me/docs', 'ash_agent', 'search', undefined, 'deny');

    // Should proceed because existing is allow, not deny
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it('does not match different user', () => {
    mockExecSync.mockReturnValueOnce(
      'total 0\n 0: user:other_user allow search\n' as never,
    );
    mockExecSync.mockReturnValueOnce('' as never);

    addUserAcl('/Users/me/docs', 'ash_agent', 'search', undefined, 'allow');

    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it('fails open when ls -le throws', () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error('ls failed'); });
    mockExecSync.mockReturnValueOnce('' as never);

    addUserAcl('/Users/me/docs', 'ash_agent', 'search');

    // Should proceed with chmod after hasUserAcl fails open
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it('skips non-existent paths', () => {
    mockExistsSync.mockReturnValue(false);

    const log = { warn: jest.fn() };
    addUserAcl('/nonexistent', 'ash_agent', 'search', log);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('skipping non-existent'));
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

describe('removeAllUserAcls', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
    // Default: ls -le returns a matching ACL entry, chmod succeeds
    mockExecSync.mockReturnValue(
      'total 0\n 0: user:ash_agent allow read,search\n' as never,
    );
  });

  it('removes ACLs from workspace paths', () => {
    removeAllUserAcls('ash_agent', ['/Users/me/project'], []);

    // Should have called ls -le for the path + ancestors (/Users/me is non-world-traversable)
    const lsCalls = mockExecSync.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && cmd.includes('ls -le'),
    );
    expect(lsCalls.length).toBeGreaterThanOrEqual(1);
    // Should include the workspace path itself
    expect(lsCalls.some(([cmd]) => (cmd as string).includes('/Users/me/project'))).toBe(true);
  });

  it('removes ACLs from traversal ancestors', () => {
    removeAllUserAcls('ash_agent', ['/Users/me/deep/path'], []);

    const lsCalls = mockExecSync.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && cmd.includes('ls -le'),
    );
    // Should include ancestors: /Users/me/deep, /Users/me
    const paths = lsCalls.map(([cmd]) => (cmd as string));
    expect(paths.some(cmd => cmd.includes('/Users/me/deep'))).toBe(true);
    expect(paths.some(cmd => cmd.includes('/Users/me"'))).toBe(true);
  });

  it('removes ACLs from filesystem policy paths', () => {
    const policies = [
      makePolicy({
        action: 'allow',
        operations: ['file_read'],
        patterns: ['/data/shared'],
      }),
    ];

    removeAllUserAcls('ash_agent', [], policies);

    const lsCalls = mockExecSync.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && cmd.includes('ls -le'),
    );
    expect(lsCalls.some(([cmd]) => (cmd as string).includes('/data/shared'))).toBe(true);
  });

  it('deduplicates paths across workspace and policy', () => {
    const policies = [
      makePolicy({
        action: 'allow',
        operations: ['file_read'],
        patterns: ['/Users/me/project/**'],
      }),
    ];

    removeAllUserAcls('ash_agent', ['/Users/me/project'], policies);

    // /Users/me/project should appear in ls -le calls only once
    const lsCalls = mockExecSync.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && cmd.includes('ls -le') && (cmd as string).includes('/Users/me/project"'),
    );
    expect(lsCalls).toHaveLength(1);
  });
});
