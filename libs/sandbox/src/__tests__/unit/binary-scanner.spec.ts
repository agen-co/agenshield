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
import {
  scanBinaries,
  classifyDirectory,
  getProtection,
  categorize,
  isShieldExecLink,
} from '../../detection/discovery/binary-scanner';

const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedReaddirSync = fs.readdirSync as jest.MockedFunction<typeof fs.readdirSync>;

describe('scanBinaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
    mockedReaddirSync.mockReturnValue([]);
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

describe('getProtection', () => {
  it('returns proxied for commands in PROXIED_COMMANDS', () => {
    expect(getProtection('curl')).toBe('proxied');
    expect(getProtection('git')).toBe('proxied');
  });

  it('returns wrapped for commands in WRAPPER_DEFINITIONS', () => {
    expect(getProtection('python')).toBe('wrapped');
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
  it('returns false when readlinkSync throws', () => {
    expect(isShieldExecLink('/usr/local/bin/nonexistent')).toBe(false);
  });
});
