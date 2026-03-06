jest.mock('node:child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn(),
}));
jest.mock('node:fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  readFile: jest.fn(),
  stat: jest.fn(),
  access: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined),
  symlink: jest.fn().mockResolvedValue(undefined),
  constants: { X_OK: 1 },
}));
jest.mock('node:util', () => ({
  ...jest.requireActual('node:util'),
  promisify: jest.fn(() => jest.fn().mockResolvedValue({ stdout: '', stderr: '' })),
}));
jest.mock('../../wrappers/generic-wrapper', () => ({
  installGenericWrapper: jest.fn().mockResolvedValue('/mock/generic-wrapper'),
  syncGenericWrappers: jest.fn().mockResolvedValue({ created: [], skipped: [] }),
}));

import * as fs from 'node:fs/promises';
import { promisify } from 'node:util';
import {
  WRAPPERS,
  WRAPPER_DEFINITIONS,
  getDefaultWrapperConfig,
  generateWrapperContent,
  getAvailableWrappers,
  wrapperUsesSeatbelt,
  wrapperUsesInterceptor,
  installWrapper,
  installAllWrappers,
  uninstallWrapper,
  verifyWrappers,
  deployInterceptor,
  copyNodeBinary,
  installAgentNvm,
} from '../../wrappers/wrappers';

const mockFs = fs as jest.Mocked<typeof fs>;

describe('WRAPPERS', () => {
  it('is defined and non-empty', () => {
    expect(WRAPPERS).toBeDefined();
    expect(Object.keys(WRAPPERS).length).toBeGreaterThan(0);
  });

  it('each wrapper has description and content', () => {
    for (const [name, wrapper] of Object.entries(WRAPPERS)) {
      expect(wrapper.description).toBeDefined();
      expect(typeof wrapper.description).toBe('string');
      expect(wrapper.description.length).toBeGreaterThan(0);

      expect(wrapper.content).toBeDefined();
      expect(typeof wrapper.content).toBe('string');
      expect(wrapper.content.length).toBeGreaterThan(0);
    }
  });

  it('each wrapper content starts with #!/bin/bash', () => {
    for (const [name, wrapper] of Object.entries(WRAPPERS)) {
      expect(wrapper.content.startsWith('#!/bin/bash')).toBe(true);
    }
  });
});

describe('WRAPPER_DEFINITIONS', () => {
  it('includes key commands (git, npm, node)', () => {
    expect(WRAPPER_DEFINITIONS['git']).toBeDefined();
    expect(WRAPPER_DEFINITIONS['npm']).toBeDefined();
    expect(WRAPPER_DEFINITIONS['node']).toBeDefined();
  });

  it('includes curl and wget', () => {
    expect(WRAPPER_DEFINITIONS['curl']).toBeDefined();
    expect(WRAPPER_DEFINITIONS['wget']).toBeDefined();
  });

  it('includes python/pip wrappers', () => {
    expect(WRAPPER_DEFINITIONS['python']).toBeDefined();
    expect(WRAPPER_DEFINITIONS['pip']).toBeDefined();
  });

  it('includes brew wrapper', () => {
    expect(WRAPPER_DEFINITIONS['brew']).toBeDefined();
  });

  it('each definition has a description and generate function', () => {
    for (const [name, def] of Object.entries(WRAPPER_DEFINITIONS)) {
      expect(def.description).toBeDefined();
      expect(typeof def.description).toBe('string');
      expect(typeof def.generate).toBe('function');
    }
  });

  it('node wrapper uses interceptor', () => {
    expect(WRAPPER_DEFINITIONS['node'].usesInterceptor).toBe(true);
  });

  it('python wrapper uses seatbelt', () => {
    expect(WRAPPER_DEFINITIONS['python'].usesSeatbelt).toBe(true);
  });
});

describe('getDefaultWrapperConfig', () => {
  it('returns valid config object', () => {
    const config = getDefaultWrapperConfig();

    expect(config.agentHome).toBeDefined();
    expect(config.agentUsername).toBeDefined();
    expect(config.socketPath).toBeDefined();
    expect(config.httpPort).toBeDefined();
    expect(config.interceptorPath).toBeDefined();
    expect(config.seatbeltDir).toBeDefined();
    expect(config.nodePath).toBeDefined();
    expect(config.npmPath).toBeDefined();
    expect(config.brewPath).toBeDefined();
    expect(config.shieldClientPath).toBeDefined();
    expect(config.nodeBinPath).toBeDefined();
  });

  it('uses userConfig values when provided', () => {
    const config = getDefaultWrapperConfig({
      agentUser: {
        username: 'ash_custom_agent',
        uid: 5200,
        gid: 5100,
        home: '/Users/ash_custom_agent',
        shell: '/bin/bash',
        realname: 'Custom',
        groups: ['ash_custom'],
      },
      brokerUser: {
        username: 'ash_custom_broker',
        uid: 5201,
        gid: 5100,
        home: '/var/empty',
        shell: '/bin/bash',
        realname: 'Broker',
        groups: ['ash_custom'],
      },
      groups: {
        socket: { name: 'ash_custom', gid: 5100, description: 'Custom socket' },
      },
      prefix: '',
      baseName: 'custom',
      baseUid: 5200,
      baseGid: 5100,
    });

    expect(config.agentHome).toBe('/Users/ash_custom_agent');
    expect(config.agentUsername).toBe('ash_custom_agent');
    expect(config.socketPath).toContain('ash_custom_agent');
  });

  it('socket path points to .agenshield/run', () => {
    const config = getDefaultWrapperConfig();

    expect(config.socketPath).toContain('.agenshield/run/agenshield.sock');
  });
});

describe('generateWrapperContent', () => {
  it('returns content for known wrappers', () => {
    const content = generateWrapperContent('git');

    expect(content).toBeDefined();
    expect(typeof content).toBe('string');
    expect(content!.startsWith('#!/bin/bash')).toBe(true);
  });

  it('returns null for unknown wrapper', () => {
    const content = generateWrapperContent('nonexistent-wrapper');

    expect(content).toBeNull();
  });

  it('git wrapper distinguishes network vs local operations', () => {
    const content = generateWrapperContent('git');

    expect(content).toContain('clone|fetch|push|pull');
    expect(content).toContain('/usr/bin/git');
  });
});

describe('getAvailableWrappers', () => {
  it('returns array of wrapper names', () => {
    const names = getAvailableWrappers();

    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('git');
    expect(names).toContain('npm');
    expect(names).toContain('node');
  });
});

describe('wrapperUsesSeatbelt', () => {
  it('returns true for python', () => {
    expect(wrapperUsesSeatbelt('python')).toBe(true);
  });

  it('returns true for pip', () => {
    expect(wrapperUsesSeatbelt('pip')).toBe(true);
  });

  it('returns false for git', () => {
    expect(wrapperUsesSeatbelt('git')).toBe(false);
  });

  it('returns false for unknown wrapper', () => {
    expect(wrapperUsesSeatbelt('nonexistent')).toBe(false);
  });
});

describe('wrapperUsesInterceptor', () => {
  it('returns true for node', () => {
    expect(wrapperUsesInterceptor('node')).toBe(true);
  });

  it('returns false for git', () => {
    expect(wrapperUsesInterceptor('git')).toBe(false);
  });

  it('returns false for unknown wrapper', () => {
    expect(wrapperUsesInterceptor('nonexistent')).toBe(false);
  });
});

describe('installWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFile.mockResolvedValue(undefined);
  });

  it('installs a single wrapper with correct file operations', async () => {
    const result = await installWrapper('git', '#!/bin/bash\nexec /usr/bin/git "$@"', '/tmp/bin');

    expect(result.success).toBe(true);
    expect(result.name).toBe('git');
    expect(result.path).toBe('/tmp/bin/git');
    expect(result.message).toContain('Installed git');
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/tmp/bin/git',
      '#!/bin/bash\nexec /usr/bin/git "$@"',
      { mode: 0o755 },
    );
  });

  it('returns failure result on write error', async () => {
    mockFs.writeFile.mockRejectedValue(new Error('Permission denied'));

    const result = await installWrapper('git', '#!/bin/bash', '/root/bin');

    expect(result.success).toBe(false);
    expect(result.name).toBe('git');
    expect(result.message).toContain('Failed to install git');
    expect(result.error).toBeDefined();
  });

  it('sets mode 755 on wrapper file', async () => {
    await installWrapper('curl', '#!/bin/bash\nexec /usr/bin/curl "$@"', '/tmp/bin');

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/tmp/bin/curl',
      expect.any(String),
      { mode: 0o755 },
    );
  });
});

describe('installWrapperWithSudo', () => {
  it('uses sudo for installation', async () => {
    const { installWrapperWithSudo } = await import('../../wrappers/wrappers');

    const result = await installWrapperWithSudo(
      'git',
      '#!/bin/bash\nexec /usr/bin/git "$@"',
      '/usr/local/bin',
      'agenshield_agent',
      'agenshield',
    );

    expect(result.success).toBe(true);
    expect(result.name).toBe('git');
    expect(result.path).toBe('/usr/local/bin/git');
    expect(result.message).toContain('with sudo');
  });
});

describe('installAllWrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
  });

  it('installs all wrappers and returns their names', async () => {
    const userConfig = {
      agentUser: {
        username: 'agenshield_agent',
        uid: 5200,
        gid: 5100,
        home: '/Users/agenshield_agent',
        shell: '/bin/bash',
        realname: 'Agent',
        groups: ['ash_socket'],
      },
      brokerUser: {
        username: 'agenshield_broker',
        uid: 5201,
        gid: 5100,
        home: '/var/empty',
        shell: '/bin/bash',
        realname: 'Broker',
        groups: ['ash_socket'],
      },
      groups: {
        socket: { name: 'ash_socket', gid: 5100, description: 'Socket group' },
      },
      prefix: '',
      baseName: 'default',
      baseUid: 5200,
      baseGid: 5100,
    };

    const result = await installAllWrappers(userConfig, {
      binDir: '/tmp/test-bin',
      wrappersDir: '/tmp/test-wrappers',
    });

    expect(result.success).toBe(true);
    expect(result.installed).toBeDefined();
    expect(result.installed!.length).toBeGreaterThan(0);
    // Should include all wrapper definitions
    const wrapperNames = Object.keys(WRAPPER_DEFINITIONS);
    for (const name of wrapperNames) {
      expect(result.installed).toContain(name);
    }
  });
});

describe('uninstallWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.unlink.mockResolvedValue(undefined);
  });

  it('removes a wrapper', async () => {
    const result = await uninstallWrapper('git', '/tmp/bin');

    expect(result.success).toBe(true);
    expect(result.name).toBe('git');
    expect(result.path).toBe('/tmp/bin/git');
    expect(result.message).toContain('Uninstalled git');
    expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/bin/git');
  });

  it('succeeds when file already removed (ENOENT)', async () => {
    const err = new Error('not found') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockFs.unlink.mockRejectedValue(err);

    const result = await uninstallWrapper('git', '/tmp/bin');

    expect(result.success).toBe(true);
    expect(result.message).toContain('already removed');
  });

  it('returns failure for other errors', async () => {
    const err = new Error('permission denied') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    mockFs.unlink.mockRejectedValue(err);

    const result = await uninstallWrapper('git', '/tmp/bin');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to uninstall git');
    expect(result.error).toBeDefined();
  });
});

describe('verifyWrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports installed wrappers when access succeeds', async () => {
    mockFs.access.mockResolvedValue(undefined);

    const result = await verifyWrappers('/tmp/bin');

    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.installed.length).toBe(Object.keys(WRAPPER_DEFINITIONS).length);
  });

  it('reports missing wrappers when access fails', async () => {
    mockFs.access.mockRejectedValue(new Error('not found'));

    const result = await verifyWrappers('/tmp/bin');

    expect(result.valid).toBe(false);
    expect(result.installed).toHaveLength(0);
    expect(result.missing.length).toBe(Object.keys(WRAPPER_DEFINITIONS).length);
  });

  it('reports partial installation correctly', async () => {
    let callIndex = 0;
    mockFs.access.mockImplementation(() => {
      callIndex++;
      if (callIndex <= 3) {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error('not found'));
    });

    const result = await verifyWrappers('/tmp/bin');
    const totalWrappers = Object.keys(WRAPPER_DEFINITIONS).length;

    expect(result.valid).toBe(false);
    expect(result.installed).toHaveLength(3);
    expect(result.missing).toHaveLength(totalWrappers - 3);
  });
});

describe('deployInterceptor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.access.mockResolvedValue(undefined);
  });

  it('returns correct target path based on hostHome', async () => {
    const result = await deployInterceptor(undefined, '/Users/custom');

    expect(result.path).toBe('/Users/custom/.agenshield/lib/interceptor/register.cjs');
  });

  it('returns failure when interceptor source cannot be resolved', async () => {
    mockFs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await deployInterceptor(undefined, '/Users/testuser');

    expect(result.success).toBe(false);
    expect(result.name).toBe('interceptor');
    expect(result.message).toContain('Failed to deploy interceptor');
  });
});

describe('copyNodeBinary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.access.mockResolvedValue(undefined);
  });

  it('copies node binary to agent bin', async () => {
    const result = await copyNodeBinary(undefined, '/usr/local/bin/node', '/Users/testuser');

    expect(result.success).toBe(true);
    expect(result.name).toBe('node-bin');
    expect(result.path).toBe('/Users/testuser/.agenshield/bin/node-bin');
    expect(result.message).toContain('Copied node binary');
  });

  it('uses process.execPath when sourcePath not provided', async () => {
    const result = await copyNodeBinary(undefined, undefined, '/Users/testuser');

    expect(result.success).toBe(true);
    expect(result.message).toContain(process.execPath);
  });
});

describe('installAgentNvm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('installs NVM for agent user', async () => {
    const result = await installAgentNvm({
      agentHome: '/Users/agenshield_agent',
      agentUsername: 'agenshield_agent',
      socketGroupName: 'ash_socket',
      nodeVersion: '24',
      verbose: false,
    });

    expect(result.nvmDir).toBe('/Users/agenshield_agent/.nvm');
    // Success depends on the mock behavior of execAsync
    expect(result.message).toBeDefined();
  });
});
