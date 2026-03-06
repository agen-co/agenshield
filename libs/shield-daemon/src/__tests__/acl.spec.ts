import { stripGlobToBasePath, operationsToAclPerms, computeAclMap, isFilesystemRelevant, addUserAcl, removeUserAcl, removeAllUserAcls, removeOrphanedAcls, verifyUserAcl, denyWorkspaceSkill, resolveGlobInWorkspaces } from '../acl';
import type { PolicyConfig } from '@agenshield/ipc';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
}));

jest.mock('../config/paths', () => ({
  isDevMode: () => false,
}));

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReaddirSync = fs.readdirSync as jest.MockedFunction<typeof fs.readdirSync>;

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

  it('skips cross-cutting deny patterns that resolve to root', () => {
    const policies = [
      makePolicy({
        action: 'deny',
        operations: ['file_read'],
        patterns: ['**/.env', '**/.credentials'],
      }),
    ];
    const { deny } = computeAclMap(policies);
    // **/.env strips to / which is too broad for ACLs — must be skipped
    expect(deny.size).toBe(0);
    expect(deny.has('/')).toBe(false);
  });

  it('keeps deny patterns that resolve to a specific directory', () => {
    const policies = [
      makePolicy({
        action: 'deny',
        operations: ['file_read'],
        patterns: ['**/.env', '/etc/passwd'],
      }),
    ];
    const { deny } = computeAclMap(policies);
    // **/.env skipped, /etc/passwd kept
    expect(deny.has('/etc/passwd')).toBe(true);
    expect(deny.has('/')).toBe(false);
    expect(deny.size).toBe(1);
  });
});

describe('resolveGlobInWorkspaces', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('finds .env files in workspace directories', () => {
    // Mock directory structure: /ws/project/.env and /ws/project/src/app.ts
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr === '/ws/project') {
        return [
          { name: '.env', isDirectory: () => false, isFile: () => true },
          { name: 'src', isDirectory: () => true, isFile: () => false },
        ] as any;
      }
      if (dirStr === '/ws/project/src') {
        return [
          { name: 'app.ts', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      return [] as any;
    });

    const result = resolveGlobInWorkspaces('**/.env', ['/ws/project']);
    expect(result).toEqual(['/ws/project/.env']);
  });

  it('finds nested .env files', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr === '/ws') {
        return [
          { name: '.env', isDirectory: () => false, isFile: () => true },
          { name: 'sub', isDirectory: () => true, isFile: () => false },
        ] as any;
      }
      if (dirStr === '/ws/sub') {
        return [
          { name: '.env', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      return [] as any;
    });

    const result = resolveGlobInWorkspaces('**/.env', ['/ws']);
    expect(result).toEqual(['/ws/.env', '/ws/sub/.env']);
  });

  it('skips node_modules and .git', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr === '/ws') {
        return [
          { name: 'node_modules', isDirectory: () => true, isFile: () => false },
          { name: '.git', isDirectory: () => true, isFile: () => false },
          { name: '.env', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      // node_modules and .git should never be walked
      throw new Error(`Should not walk ${dirStr}`);
    });

    const result = resolveGlobInWorkspaces('**/.env', ['/ws']);
    expect(result).toEqual(['/ws/.env']);
  });

  it('returns empty for wildcard filename glob', () => {
    const result = resolveGlobInWorkspaces('**/*', ['/ws']);
    expect(result).toEqual([]);
  });
});

describe('computeAclMap with workspacePaths', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('resolves **/.env against workspace paths into deny map', () => {
    mockReaddirSync.mockImplementation((dir: any) => {
      const dirStr = String(dir);
      if (dirStr === '/ws/project') {
        return [
          { name: '.env', isDirectory: () => false, isFile: () => true },
          { name: 'src', isDirectory: () => true, isFile: () => false },
        ] as any;
      }
      if (dirStr === '/ws/project/src') {
        return [] as any;
      }
      return [] as any;
    });

    const policies = [
      makePolicy({
        action: 'deny',
        operations: ['file_read'],
        patterns: ['**/.env'],
      }),
    ];

    const { deny } = computeAclMap(policies, ['/ws/project']);
    expect(deny.has('/ws/project/.env')).toBe(true);
    expect(deny.get('/ws/project/.env')).toContain('read');
    expect(deny.has('/')).toBe(false);
  });

  it('still skips cross-cutting globs when no workspace paths provided', () => {
    const policies = [
      makePolicy({
        action: 'deny',
        operations: ['file_read'],
        patterns: ['**/.env'],
      }),
    ];

    const { deny } = computeAclMap(policies);
    expect(deny.size).toBe(0);
  });
});

describe('addUserAcl (idempotency)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('skips chmod when ACL entry already exists with matching permissions', () => {
    // ls -led returns an existing entry that covers the requested permissions
    mockExecSync.mockReturnValueOnce(
      'total 0\n 0: user:ash_agent allow read,readattr,readextattr,list,search,execute\n' as never,
    );

    addUserAcl('/Users/me/docs', 'ash_agent', 'search', undefined, 'allow');

    // Should only have called ls -led (for hasUserAcl check), no chmod
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('ls -led'),
      expect.any(Object),
    );
  });

  it('proceeds with chmod when no matching ACL entry exists', () => {
    // ls -led returns empty (no ACLs)
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

  it('fails open when ls -led throws', () => {
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

describe('addUserAcl (return values)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('returns true when ACL already exists (idempotent)', () => {
    mockExecSync.mockReturnValueOnce(
      'total 0\n 0: user:ash_agent allow search\n' as never,
    );

    const result = addUserAcl('/Users/me/docs', 'ash_agent', 'search', undefined, 'allow');
    expect(result).toBe(true);
  });

  it('returns true when chmod succeeds', () => {
    mockExecSync.mockReturnValueOnce('total 0\n' as never);
    mockExecSync.mockReturnValueOnce('' as never);

    const result = addUserAcl('/Users/me/docs', 'ash_agent', 'search', undefined, 'allow');
    expect(result).toBe(true);
  });

  it('returns false when path does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const log = { warn: jest.fn() };
    const result = addUserAcl('/nonexistent', 'ash_agent', 'search', log);
    expect(result).toBe(false);
  });

  it('returns false when both chmod and sudo chmod fail', () => {
    mockExecSync.mockReturnValueOnce('total 0\n' as never);
    mockExecSync.mockImplementationOnce(() => { throw new Error('denied'); });
    mockExecSync.mockImplementationOnce(() => { throw new Error('sudo denied'); });

    const log = { warn: jest.fn() };
    const result = addUserAcl('/Users/me/docs', 'ash_agent', 'search', log);
    expect(result).toBe(false);
  });
});

describe('verifyUserAcl', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns true when matching ACL exists', () => {
    mockExecSync.mockReturnValueOnce(
      'total 0\n 0: user:ash_agent deny read,readattr,readextattr,list,search,execute\n' as never,
    );

    const result = verifyUserAcl('/skill/dir', 'ash_agent', 'read,search', 'deny');
    expect(result).toBe(true);
  });

  it('returns false when no matching ACL exists', () => {
    mockExecSync.mockReturnValueOnce('total 0\n' as never);

    const result = verifyUserAcl('/skill/dir', 'ash_agent', 'read,search', 'deny');
    expect(result).toBe(false);
  });
});

describe('denyWorkspaceSkill (return value)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('returns true when ACL applied and verified', () => {
    // hasUserAcl check: no existing ACL
    mockExecSync.mockReturnValueOnce('total 0\n' as never);
    // chmod succeeds
    mockExecSync.mockReturnValueOnce('' as never);
    // chflags hidden (best-effort)
    mockExecSync.mockReturnValueOnce('' as never);
    // verifyUserAcl check: ACL now present
    mockExecSync.mockReturnValueOnce(
      'total 0\n 0: user:ash_agent deny read,readattr,readextattr,list,search,execute\n' as never,
    );

    const result = denyWorkspaceSkill('/skills/test', 'ash_agent');
    expect(result).toBe(true);
  });

  it('returns false when chmod fails', () => {
    // hasUserAcl: no existing
    mockExecSync.mockReturnValueOnce('total 0\n' as never);
    // chmod fails
    mockExecSync.mockImplementationOnce(() => { throw new Error('denied'); });
    // sudo chmod also fails
    mockExecSync.mockImplementationOnce(() => { throw new Error('sudo denied'); });

    const log = { warn: jest.fn() };
    const result = denyWorkspaceSkill('/skills/test', 'ash_agent', log);
    expect(result).toBe(false);
  });
});

describe('removeAllUserAcls', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
    // Default: ls -led returns a matching ACL entry, chmod succeeds
    mockExecSync.mockReturnValue(
      'total 0\n 0: user:ash_agent allow read,search\n' as never,
    );
  });

  it('removes ACLs from workspace paths', () => {
    removeAllUserAcls('ash_agent', ['/Users/me/project'], []);

    // Should have called ls -led for the path + ancestors (/Users/me is non-world-traversable)
    const lsCalls = mockExecSync.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && cmd.includes('ls -led'),
    );
    expect(lsCalls.length).toBeGreaterThanOrEqual(1);
    // Should include the workspace path itself
    expect(lsCalls.some(([cmd]) => (cmd as string).includes('/Users/me/project'))).toBe(true);
  });

  it('removes ACLs from traversal ancestors', () => {
    removeAllUserAcls('ash_agent', ['/Users/me/deep/path'], []);

    const lsCalls = mockExecSync.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && cmd.includes('ls -led'),
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
      typeof cmd === 'string' && cmd.includes('ls -led'),
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

    // /Users/me/project should appear in ls -led calls only once
    const lsCalls = mockExecSync.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && cmd.includes('ls -led') && (cmd as string).includes('/Users/me/project"'),
    );
    expect(lsCalls).toHaveLength(1);
  });
});

describe('removeOrphanedAcls', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('removes bare UUID ACL entries', () => {
    mockExecSync.mockReturnValueOnce(
      [
        'drwxr-xr-x+ 20 user  staff  640 Jan  1 00:00 .',
        ' 0: user:ash_agent allow search',
        ' 1: 33C7868A-1234-5678-9ABC-4F2E1A3BDEF0 allow search',
        ' 2: AABBCCDD-1111-2222-3333-444455556666 deny read',
        '',
      ].join('\n') as never,
    );
    // Two chmod calls (index 2 first, then 1)
    mockExecSync.mockReturnValueOnce('' as never);
    mockExecSync.mockReturnValueOnce('' as never);

    const log = { warn: jest.fn() };
    removeOrphanedAcls('/Users/me', log);

    // ls -led + 2 chmod calls
    expect(mockExecSync).toHaveBeenCalledTimes(3);
    // Highest index first
    expect(mockExecSync).toHaveBeenNthCalledWith(2,
      'chmod -a# 2 "/Users/me"',
      expect.any(Object),
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(3,
      'chmod -a# 1 "/Users/me"',
      expect.any(Object),
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('removed 2 orphaned'));
  });

  it('skips user: entries (only removes bare UUIDs)', () => {
    mockExecSync.mockReturnValueOnce(
      [
        'drwxr-xr-x+ 20 user  staff  640 Jan  1 00:00 .',
        ' 0: user:ash_agent allow search',
        ' 1: user:other_user deny read',
        '',
      ].join('\n') as never,
    );

    const log = { warn: jest.fn() };
    removeOrphanedAcls('/Users/me', log);

    // Only ls -led, no chmod
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('handles empty ACL output', () => {
    mockExecSync.mockReturnValueOnce('drwxr-xr-x  20 user  staff  640 Jan  1 00:00 .\n' as never);

    const log = { warn: jest.fn() };
    removeOrphanedAcls('/Users/me', log);

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('skips non-existent paths', () => {
    mockExistsSync.mockReturnValue(false);

    const log = { warn: jest.fn() };
    removeOrphanedAcls('/nonexistent', log);

    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('falls back to sudo when chmod fails', () => {
    mockExecSync.mockReturnValueOnce(
      [
        'drwxr-xr-x+ 20 user  staff  640 Jan  1 00:00 .',
        ' 0: AABBCCDD-1111-2222-3333-444455556666 allow search',
        '',
      ].join('\n') as never,
    );
    // First chmod attempt fails
    mockExecSync.mockImplementationOnce(() => { throw new Error('Permission denied'); });
    // sudo chmod succeeds
    mockExecSync.mockReturnValueOnce('' as never);

    const log = { warn: jest.fn() };
    removeOrphanedAcls('/Users/me', log);

    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(mockExecSync).toHaveBeenNthCalledWith(3,
      'sudo chmod -a# 0 "/Users/me"',
      expect.any(Object),
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('removed 1 orphaned'));
  });

  it('logs summary with correct count', () => {
    mockExecSync.mockReturnValueOnce(
      [
        'drwxr-xr-x+ 20 user  staff  640 Jan  1 00:00 .',
        ' 0: 11111111-1111-1111-1111-111111111111 allow search',
        '',
      ].join('\n') as never,
    );
    mockExecSync.mockReturnValueOnce('' as never);

    const log = { warn: jest.fn() };
    removeOrphanedAcls('/Users/me', log);

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('removed 1 orphaned UUID-based ACL entry from /Users/me'),
    );
  });
});
