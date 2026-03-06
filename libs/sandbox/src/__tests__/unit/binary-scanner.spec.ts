jest.mock('@agenshield/ipc', () => ({
  COMMAND_CATALOG: {
    git: { category: 'vcs' },
    curl: { category: 'network' },
    python: { category: 'runtime' },
    node: { category: 'runtime' },
  },
  seatbeltDirPath: () => '/tmp/.agenshield/seatbelt',
  socketPath: () => '/tmp/.agenshield/run/agenshield.sock',
}));

jest.mock('../../wrappers/wrappers', () => ({
  WRAPPER_DEFINITIONS: {
    python: { description: 'Python wrapper', usesSeatbelt: false, usesInterceptor: false },
    python3: { description: 'Python3 wrapper', usesSeatbelt: false, usesInterceptor: false },
  },
}));

jest.mock('node:child_process', () => ({
  execSync: jest.fn().mockImplementation(() => {
    throw new Error('not found');
  }),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readdirSync: jest.fn().mockReturnValue([]),
  statSync: jest.fn().mockReturnValue({ isFile: () => true, mode: 0o755 }),
  lstatSync: jest.fn().mockReturnValue({ isSymbolicLink: () => false }),
  readFileSync: jest.fn().mockReturnValue('{}'),
  readlinkSync: jest.fn().mockImplementation(() => {
    throw new Error('not a link');
  }),
}));

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import {
  scanBinaries,
  classifyDirectory,
  getContextsForDir,
  getProtection,
  categorize,
  isShieldExecLink,
  detectNpmGlobalBin,
  detectYarnGlobalBin,
} from '../../detection/discovery/binary-scanner';

const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedReaddirSync = fs.readdirSync as jest.MockedFunction<typeof fs.readdirSync>;
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;
const mockedLstatSync = fs.lstatSync as jest.MockedFunction<typeof fs.lstatSync>;
const mockedReadlinkSync = fs.readlinkSync as jest.MockedFunction<typeof fs.readlinkSync>;
const mockedReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

describe('detectNpmGlobalBin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedExistsSync.mockReturnValue(false);
  });

  it('returns null when npm is not available', () => {
    expect(detectNpmGlobalBin()).toBeNull();
  });

  it('returns bin path when npm prefix succeeds and bin dir exists', () => {
    mockedExecSync.mockReturnValue('/usr/local\n');
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/usr/local/bin';
    });

    expect(detectNpmGlobalBin()).toBe('/usr/local/bin');
  });

  it('returns null when npm prefix returns empty string', () => {
    mockedExecSync.mockReturnValue('\n');

    expect(detectNpmGlobalBin()).toBeNull();
  });

  it('returns null when bin directory does not exist', () => {
    mockedExecSync.mockReturnValue('/usr/local\n');
    mockedExistsSync.mockReturnValue(false);

    expect(detectNpmGlobalBin()).toBeNull();
  });
});

describe('detectYarnGlobalBin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedExistsSync.mockReturnValue(false);
  });

  it('returns null when yarn is not available', () => {
    expect(detectYarnGlobalBin()).toBeNull();
  });

  it('returns bin path when yarn global bin succeeds and dir exists', () => {
    mockedExecSync.mockReturnValue('/Users/testuser/.yarn/bin\n');
    mockedExistsSync.mockReturnValue(true);

    expect(detectYarnGlobalBin()).toBe('/Users/testuser/.yarn/bin');
  });

  it('returns null when yarn returns empty string', () => {
    mockedExecSync.mockReturnValue('\n');

    expect(detectYarnGlobalBin()).toBeNull();
  });

  it('returns null when yarn bin directory does not exist', () => {
    mockedExecSync.mockReturnValue('/Users/testuser/.yarn/bin\n');
    mockedExistsSync.mockReturnValue(false);

    expect(detectYarnGlobalBin()).toBeNull();
  });
});

describe('scanBinaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
    mockedReaddirSync.mockReturnValue([]);
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedStatSync.mockReturnValue({ isFile: () => true, mode: 0o755 } as any);
    mockedLstatSync.mockReturnValue({ isSymbolicLink: () => false } as any);
    mockedReadlinkSync.mockImplementation(() => { throw new Error('not a link'); });
  });

  it('returns arrays of binaries and directories', () => {
    const result = scanBinaries({});

    expect(result).toHaveProperty('binaries');
    expect(result).toHaveProperty('directories');
    expect(Array.isArray(result.binaries)).toBe(true);
    expect(Array.isArray(result.directories)).toBe(true);
  });

  it('returns empty arrays when no directories exist', () => {
    const result = scanBinaries({});

    expect(result.binaries).toHaveLength(0);
    expect(result.directories).toHaveLength(0);
  });

  it('scans agent bin directory when agentHome is provided', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/ash_default_agent/bin';
    });
    mockedReaddirSync.mockReturnValue([]);

    scanBinaries({ agentHome: '/Users/ash_default_agent' });

    // Should attempt to scan the agent bin directory
    expect(mockedExistsSync).toHaveBeenCalledWith('/Users/ash_default_agent/bin');
  });

  it('discovers binaries in existing directories and sorts them by name', () => {
    const testDir = '/test/bin';
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === testDir;
    });
    mockedReaddirSync.mockImplementation((p: unknown) => {
      if (String(p) === testDir) return ['zcmd', 'acmd', 'mcmd'] as any;
      return [] as any;
    });

    const result = scanBinaries({ extraDirs: [testDir] });

    expect(result.binaries.length).toBeGreaterThanOrEqual(3);
    expect(result.binaries.some((b) => b.name === 'acmd')).toBe(true);
    expect(result.directories.some((d) => d.path === testDir)).toBe(true);
    // Verify sorting: 'acmd' should come before 'mcmd' before 'zcmd'
    const names = result.binaries.filter((b) => ['acmd', 'mcmd', 'zcmd'].includes(b.name)).map((b) => b.name);
    expect(names).toEqual(['acmd', 'mcmd', 'zcmd']);
  });

  it('adds workspace bin directory when workspaceDir is provided', () => {
    const wsDir = '/workspace/project';
    const wsBin = '/workspace/project/node_modules/.bin';
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === wsBin;
    });
    mockedReaddirSync.mockImplementation((p: unknown) => {
      if (String(p) === wsBin) return ['eslint'] as any;
      return [] as any;
    });

    const result = scanBinaries({ workspaceDir: wsDir });

    expect(result.binaries.some((b) => b.name === 'eslint')).toBe(true);
    const eslintBin = result.binaries.find((b) => b.name === 'eslint');
    expect(eslintBin?.sourceKind).toBe('workspace-bin');
    expect(eslintBin?.contexts).toContain('workspace');
  });

  it('merges contexts for duplicate binary names across directories with different contexts', () => {
    const agentBinDir = '/Users/ash_agent/bin';
    const wsBinDir = '/workspace/project/node_modules/.bin';
    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      return s === agentBinDir || s === wsBinDir;
    });
    mockedReaddirSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === agentBinDir || s === wsBinDir) return ['sharedcmd'] as any;
      return [] as any;
    });

    const result = scanBinaries({
      agentHome: '/Users/ash_agent',
      workspaceDir: '/workspace/project',
      extraDirs: [],
    });

    // Should only have one entry for 'sharedcmd' with merged contexts from both dirs
    const matched = result.binaries.filter((b) => b.name === 'sharedcmd');
    expect(matched).toHaveLength(1);
    // Should have contexts from both agent-bin ('user') and workspace-bin ('workspace')
    expect(matched[0].contexts).toContain('user');
    expect(matched[0].contexts).toContain('workspace');
  });

  it('skips entries that are not files and not symlinks', () => {
    const testDir = '/test/bin';
    mockedExistsSync.mockImplementation((p: unknown) => String(p) === testDir);
    mockedReaddirSync.mockImplementation((p: unknown) => {
      if (String(p) === testDir) return ['subdir'] as any;
      return [] as any;
    });
    mockedStatSync.mockReturnValue({ isFile: () => false, mode: 0o755 } as any);
    mockedLstatSync.mockReturnValue({ isSymbolicLink: () => false } as any);

    const result = scanBinaries({ extraDirs: [testDir] });

    expect(result.binaries.filter((b) => b.name === 'subdir')).toHaveLength(0);
  });

  it('skips entries without execute permission', () => {
    const testDir = '/test/bin';
    mockedExistsSync.mockImplementation((p: unknown) => String(p) === testDir);
    mockedReaddirSync.mockImplementation((p: unknown) => {
      if (String(p) === testDir) return ['noexec'] as any;
      return [] as any;
    });
    mockedStatSync.mockReturnValue({ isFile: () => true, mode: 0o644 } as any);

    const result = scanBinaries({ extraDirs: [testDir] });

    expect(result.binaries.filter((b) => b.name === 'noexec')).toHaveLength(0);
  });

  it('handles stat errors gracefully', () => {
    const testDir = '/test/bin';
    mockedExistsSync.mockImplementation((p: unknown) => String(p) === testDir);
    mockedReaddirSync.mockImplementation((p: unknown) => {
      if (String(p) === testDir) return ['badfile'] as any;
      return [] as any;
    });
    mockedStatSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = scanBinaries({ extraDirs: [testDir] });

    expect(result.binaries.filter((b) => b.name === 'badfile')).toHaveLength(0);
  });

  it('handles directory read errors gracefully', () => {
    const testDir = '/test/unreadable';
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation(() => { throw new Error('EACCES'); });

    // Should not throw
    const result = scanBinaries({ extraDirs: [testDir] });
    expect(result).toBeDefined();
  });
});

describe('classifyDirectory', () => {
  it('classifies /usr/bin as system', () => {
    const result = classifyDirectory('/usr/bin', null, null, {});

    expect(result).toBe('system');
  });

  it('classifies /usr/sbin as system', () => {
    const result = classifyDirectory('/usr/sbin', null, null, {});

    expect(result).toBe('system');
  });

  it('classifies /opt/homebrew/bin as homebrew', () => {
    const result = classifyDirectory('/opt/homebrew/bin', null, null, {});

    expect(result).toBe('homebrew');
  });

  it('classifies /usr/local/bin as homebrew', () => {
    const result = classifyDirectory('/usr/local/bin', null, null, {});

    expect(result).toBe('homebrew');
  });

  it('classifies /usr/local/sbin as homebrew', () => {
    const result = classifyDirectory('/usr/local/sbin', null, null, {});

    expect(result).toBe('homebrew');
  });

  it('classifies /opt/agenshield/bin as system', () => {
    const result = classifyDirectory('/opt/agenshield/bin', null, null, {});

    expect(result).toBe('system');
  });

  it('classifies unknown directory as path-other', () => {
    const result = classifyDirectory('/some/random/dir', null, null, {});

    expect(result).toBe('path-other');
  });

  it('classifies agent bin directory as agent-bin', () => {
    const result = classifyDirectory(
      '/Users/ash_default_agent/bin',
      null,
      null,
      { agentHome: '/Users/ash_default_agent' },
    );

    expect(result).toBe('agent-bin');
  });

  it('classifies npm global bin correctly', () => {
    const result = classifyDirectory(
      '/usr/local/lib/node_modules/.bin',
      '/usr/local/lib/node_modules/.bin',
      null,
      {},
    );

    expect(result).toBe('npm-global');
  });

  it('classifies yarn global bin correctly', () => {
    const result = classifyDirectory(
      '/Users/testuser/.yarn/bin',
      null,
      '/Users/testuser/.yarn/bin',
      {},
    );

    expect(result).toBe('yarn-global');
  });

  it('classifies workspace bin correctly', () => {
    const result = classifyDirectory(
      '/workspace/project/node_modules/.bin',
      null,
      null,
      { workspaceDir: '/workspace/project' },
    );

    expect(result).toBe('workspace-bin');
  });
});

describe('getContextsForDir', () => {
  it('returns workspace context for workspace-bin source', () => {
    const result = getContextsForDir('/workspace/project/node_modules/.bin', 'workspace-bin', {});

    expect(result).toEqual(['workspace']);
  });

  it('returns user context for agent-bin source', () => {
    const result = getContextsForDir('/Users/ash_default_agent/bin', 'agent-bin', {});

    expect(result).toEqual(['user']);
  });

  it('returns root context for system source', () => {
    const result = getContextsForDir('/usr/bin', 'system', {});

    expect(result).toEqual(['root']);
  });

  it('returns root context for path-other source', () => {
    const result = getContextsForDir('/some/dir', 'path-other', {});

    expect(result).toEqual(['root']);
  });
});

describe('getProtection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockReturnValue('{}');
  });

  it('returns proxied for commands in PROXIED_COMMANDS', () => {
    expect(getProtection('curl')).toBe('proxied');
    expect(getProtection('git')).toBe('proxied');
  });

  it('returns wrapped for commands in WRAPPER_DEFINITIONS', () => {
    expect(getProtection('python')).toBe('wrapped');
  });

  it('returns allowed for commands in allowed-commands config', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ commands: [{ name: 'my-allowed-tool' }] }),
    );
    // Force cache reset by calling scanBinaries first
    mockedExecSync.mockImplementation(() => { throw new Error('not found'); });
    mockedReaddirSync.mockReturnValue([]);
    scanBinaries({});

    expect(getProtection('my-allowed-tool')).toBe('allowed');
  });

  it('returns unprotected for unknown commands', () => {
    expect(getProtection('some-random-binary')).toBe('unprotected');
  });
});

describe('categorize', () => {
  it('returns a category string', () => {
    const result = categorize('git');

    expect(typeof result).toBe('string');
  });

  it('returns "other" for unknown commands', () => {
    expect(categorize('my-unknown-tool-xyz')).toBe('other');
  });
});

describe('isShieldExecLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReadlinkSync.mockImplementation(() => { throw new Error('not a link'); });
  });

  it('returns false when readlinkSync throws', () => {
    expect(isShieldExecLink('/usr/local/bin/nonexistent')).toBe(false);
  });

  it('returns true when symlink target ends with shield-exec', () => {
    mockedReadlinkSync.mockReturnValue('/opt/agenshield/bin/shield-exec');

    expect(isShieldExecLink('/usr/local/bin/curl')).toBe(true);
  });

  it('returns true when symlink target is just "shield-exec"', () => {
    mockedReadlinkSync.mockReturnValue('shield-exec');

    expect(isShieldExecLink('/usr/local/bin/curl')).toBe(true);
  });

  it('returns false when symlink target is something else', () => {
    mockedReadlinkSync.mockReturnValue('/usr/bin/some-other-binary');

    expect(isShieldExecLink('/usr/local/bin/curl')).toBe(false);
  });
});
