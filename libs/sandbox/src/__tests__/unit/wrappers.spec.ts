/* ---------- var mock holders (avoid TDZ with SWC/Jest hoisting) ---------- */
var mockExecAsync = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
var mockSpawn = jest.fn();

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
  spawn: (...args: unknown[]) => mockSpawn(...args),
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
  // Return a wrapper fn that always delegates to mockExecAsync.
  // This ensures even after clearAllMocks the captured execAsync is callable.
  promisify: jest.fn(() => (...args: unknown[]) => mockExecAsync(...args)),
}));
jest.mock('../../wrappers/generic-wrapper', () => ({
  installGenericWrapper: jest.fn().mockResolvedValue('/mock/generic-wrapper'),
  syncGenericWrappers: jest.fn().mockResolvedValue({ created: [], skipped: [] }),
}));
jest.mock('@agenshield/ipc', () => ({
  isSEA: jest.fn().mockReturnValue(false),
  getSEALibDir: jest.fn().mockReturnValue(null),
}));

/* Modules that are dynamically imported in the source code need jest.mock too */
jest.mock('../../shell/guarded-shell', () => ({
  GUARDED_SHELL_CONTENT: '#!/bin/bash\n# mock guarded shell',
  ZDOT_ZSHRC_CONTENT: '# mock zshrc',
}));
jest.mock('../../legacy', () => ({
  GUARDED_SHELL_PATH: '/opt/agenshield/bin/guarded-shell',
  ZDOT_DIR: '/opt/agenshield/zdotdir',
  ZDOT_ZSHENV_CONTENT: '# mock zshenv',
}));
jest.mock('../../shell/shield-exec', () => ({
  generateShieldExecContent: jest.fn().mockReturnValue('#!/bin/bash\n# mock shield-exec'),
  shieldExecPath: jest.fn().mockReturnValue('/opt/agenshield/bin/shield-exec'),
  PROXIED_COMMANDS: ['curl', 'wget', 'git'],
}));
jest.mock('../../enforcement/seatbelt', () => ({
  generateAgentProfileFromConfig: jest.fn().mockReturnValue('(allow default)'),
  installSeatbeltProfiles: jest.fn().mockResolvedValue({ success: true }),
}));

import * as fs from 'node:fs/promises';
import { spawn as nodeSpawn } from 'node:child_process';
import { promisify } from 'node:util';
import { isSEA, getSEALibDir } from '@agenshield/ipc';
import {
  WRAPPERS,
  WRAPPER_DEFINITIONS,
  getDefaultWrapperConfig,
  generateWrapperContent,
  getAvailableWrappers,
  getWrapperDefinition,
  wrapperUsesSeatbelt,
  wrapperUsesInterceptor,
  installWrapper,
  installWrapperWithSudo,
  installWrappers,
  installSpecificWrappers,
  installAllWrappers,
  uninstallWrapper,
  uninstallWrappers,
  verifyWrappers,
  addDynamicWrapper,
  removeDynamicWrapper,
  updateWrapper,
  deployInterceptor,
  copyNodeBinary,
  copyBrokerBinary,
  copyShieldClient,
  installGuardedShell,
  installShieldExec,
  installAgentNvm,
  installBasicCommands,
  installPresetBinaries,
  patchNvmNode,
  execWithProgress,
  BASIC_SYSTEM_COMMANDS,
} from '../../wrappers/wrappers';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockIsSEA = isSEA as jest.MockedFunction<typeof isSEA>;
const mockGetSEALibDir = getSEALibDir as jest.MockedFunction<typeof getSEALibDir>;

/* ---------- helpers ---------- */
function makeUserConfig() {
  return {
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
}

/** Helper to create a fake child_process spawn return value. */
function makeSpawnChild(
  exitCode: number = 0,
  stdoutData: string = '',
  stderrData: string = '',
) {
  const stdoutCallbacks: Record<string, Function[]> = {};
  const stderrCallbacks: Record<string, Function[]> = {};
  const childCallbacks: Record<string, Function[]> = {};

  const child = {
    stdout: {
      on(event: string, cb: Function) {
        stdoutCallbacks[event] = stdoutCallbacks[event] || [];
        stdoutCallbacks[event].push(cb);
      },
    },
    stderr: {
      on(event: string, cb: Function) {
        stderrCallbacks[event] = stderrCallbacks[event] || [];
        stderrCallbacks[event].push(cb);
      },
    },
    on(event: string, cb: Function) {
      childCallbacks[event] = childCallbacks[event] || [];
      childCallbacks[event].push(cb);
    },
    kill: jest.fn(),
  };

  // Schedule emitting data and close events after returning the child
  process.nextTick(() => {
    if (stdoutData) {
      for (const cb of stdoutCallbacks['data'] || []) {
        cb(Buffer.from(stdoutData));
      }
    }
    if (stderrData) {
      for (const cb of stderrCallbacks['data'] || []) {
        cb(Buffer.from(stderrData));
      }
    }
    for (const cb of childCallbacks['close'] || []) {
      cb(exitCode);
    }
  });

  return child;
}

/* ============================ TESTS ============================ */

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSEA.mockReturnValue(false);
    mockGetSEALibDir.mockReturnValue(null);
  });

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

  it('uses SEA lib dir for interceptorPath when in SEA mode', () => {
    mockIsSEA.mockReturnValue(true);
    mockGetSEALibDir.mockReturnValue('/opt/agenshield/lib');

    const config = getDefaultWrapperConfig();

    expect(config.interceptorPath).toBe('/opt/agenshield/lib/interceptor/register.cjs');
  });

  it('uses default SEA interceptor path when getSEALibDir returns null', () => {
    mockIsSEA.mockReturnValue(true);
    mockGetSEALibDir.mockReturnValue(null);

    const config = getDefaultWrapperConfig();

    expect(config.interceptorPath).toBe('/opt/agenshield/lib/interceptor/register.cjs');
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

describe('getWrapperDefinition', () => {
  it('returns definition for known wrapper', () => {
    const def = getWrapperDefinition('git');

    expect(def).toBeDefined();
    expect(def!.description).toBeDefined();
    expect(typeof def!.generate).toBe('function');
  });

  it('returns null for unknown wrapper', () => {
    const def = getWrapperDefinition('nonexistent');

    expect(def).toBeNull();
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
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('uses sudo for installation', async () => {
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

  it('returns failure when execAsync fails', async () => {
    mockExecAsync.mockRejectedValue(new Error('sudo: password required'));

    const result = await installWrapperWithSudo(
      'git',
      '#!/bin/bash',
      '/usr/local/bin',
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to install git');
    expect(result.error).toBeDefined();
  });
});

describe('installWrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('installs all wrappers and returns results', async () => {
    const results = await installWrappers('/tmp/test-bin');

    expect(results.length).toBe(Object.keys(WRAPPER_DEFINITIONS).length);
    for (const r of results) {
      expect(r.success).toBe(true);
    }
  });

  it('falls back to sudo mkdir when direct mkdir fails', async () => {
    mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

    const results = await installWrappers('/root/bin');

    // Should still succeed because sudo mkdir fallback works
    expect(results.length).toBeGreaterThan(0);
  });

  it('continues even if both mkdir attempts fail', async () => {
    mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));
    mockExecAsync.mockRejectedValue(new Error('sudo failed'));
    // writeFile also fails for the wrapper installs
    mockFs.writeFile.mockRejectedValue(new Error('write failed'));

    const results = await installWrappers('/root/bin');

    expect(results.length).toBe(Object.keys(WRAPPER_DEFINITIONS).length);
    // All will fail because writeFile fails
    for (const r of results) {
      expect(r.success).toBe(false);
    }
  });

  it('falls back to sudo when installWrapper returns EACCES', async () => {
    const eacces = new Error('Permission denied') as NodeJS.ErrnoException;
    eacces.code = 'EACCES';
    mockFs.writeFile.mockRejectedValue(eacces);
    mockFs.mkdir.mockResolvedValue(undefined);
    // Reset execAsync to succeed for sudo fallback
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const results = await installWrappers('/tmp/test-bin');

    // Each wrapper should have attempted sudo fallback
    expect(results.length).toBe(Object.keys(WRAPPER_DEFINITIONS).length);
    // Results succeed via sudo
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.message).toContain('with sudo');
    }
  });
});

describe('installSpecificWrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('installs specified wrappers', async () => {
    const results = await installSpecificWrappers(['git', 'curl'], '/tmp/bin');

    expect(results.length).toBe(2);
    expect(results[0].success).toBe(true);
    expect(results[0].name).toBe('git');
    expect(results[1].success).toBe(true);
    expect(results[1].name).toBe('curl');
  });

  it('returns error result for unknown wrapper', async () => {
    const results = await installSpecificWrappers(['git', 'unknown-cmd'], '/tmp/bin');

    expect(results.length).toBe(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].name).toBe('unknown-cmd');
    expect(results[1].message).toContain('Unknown wrapper');
  });

  it('falls back to sudo when installWrapper returns EACCES', async () => {
    const eacces = new Error('Permission denied') as NodeJS.ErrnoException;
    eacces.code = 'EACCES';
    mockFs.writeFile.mockRejectedValue(eacces);

    const results = await installSpecificWrappers(['git'], '/tmp/bin');

    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
    expect(results[0].message).toContain('with sudo');
  });

  it('falls back to sudo mkdir when direct mkdir fails', async () => {
    mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

    const results = await installSpecificWrappers(['git'], '/tmp/bin');

    // Should still succeed since mkdir failure is tolerated
    expect(results.length).toBe(1);
  });
});

describe('installAllWrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('installs all wrappers and returns their names', async () => {
    const userConfig = makeUserConfig();

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

  it('returns failure when some wrappers fail to install', async () => {
    mockFs.writeFile.mockRejectedValue(new Error('Write failed'));
    // Make sudo also fail so wrapper actually fails
    mockExecAsync.mockRejectedValue(new Error('sudo failed'));

    const userConfig = makeUserConfig();
    const result = await installAllWrappers(userConfig, {
      binDir: '/tmp/test-bin',
      wrappersDir: '/tmp/test-wrappers',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
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

describe('uninstallWrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.unlink.mockResolvedValue(undefined);
  });

  it('uninstalls all wrappers', async () => {
    const results = await uninstallWrappers('/tmp/bin');

    expect(results.length).toBe(Object.keys(WRAPPER_DEFINITIONS).length);
    for (const r of results) {
      expect(r.success).toBe(true);
    }
  });

  it('uninstalls from default directory when none specified', async () => {
    const results = await uninstallWrappers();

    expect(results.length).toBe(Object.keys(WRAPPER_DEFINITIONS).length);
    // Check that paths reference the default directory
    expect(results[0].path).toContain('/Users/agenshield_agent/bin/');
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

describe('addDynamicWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFile.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('installs wrapper without sudo by default', async () => {
    const result = await addDynamicWrapper(
      'custom-cmd',
      '#!/bin/bash\necho custom',
      '/tmp/bin',
    );

    expect(result.success).toBe(true);
    expect(result.name).toBe('custom-cmd');
    expect(result.path).toBe('/tmp/bin/custom-cmd');
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/tmp/bin/custom-cmd',
      '#!/bin/bash\necho custom',
      { mode: 0o755 },
    );
  });

  it('installs wrapper with sudo when useSudo is true', async () => {
    const result = await addDynamicWrapper(
      'custom-cmd',
      '#!/bin/bash\necho custom',
      '/usr/local/bin',
      true,
      'root',
      'wheel',
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('with sudo');
  });
});

describe('removeDynamicWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.unlink.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('removes wrapper without sudo', async () => {
    const result = await removeDynamicWrapper('custom-cmd', '/tmp/bin');

    expect(result.success).toBe(true);
    expect(result.name).toBe('custom-cmd');
    expect(result.message).toContain('Removed dynamic wrapper');
    expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/bin/custom-cmd');
  });

  it('removes wrapper with sudo', async () => {
    const result = await removeDynamicWrapper('custom-cmd', '/usr/local/bin', true);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Removed dynamic wrapper');
    // Should use execAsync with sudo rm, not fs.unlink
    expect(mockFs.unlink).not.toHaveBeenCalled();
  });

  it('succeeds when file already removed (ENOENT)', async () => {
    const err = new Error('not found') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockFs.unlink.mockRejectedValue(err);

    const result = await removeDynamicWrapper('custom-cmd', '/tmp/bin');

    expect(result.success).toBe(true);
    expect(result.message).toContain('already removed');
  });

  it('returns failure for other errors', async () => {
    const err = new Error('permission denied') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    mockFs.unlink.mockRejectedValue(err);

    const result = await removeDynamicWrapper('custom-cmd', '/tmp/bin');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to remove');
    expect(result.error).toBeDefined();
  });
});

describe('updateWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFile.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('returns failure for unknown wrapper', async () => {
    const result = await updateWrapper('nonexistent', '/tmp/bin');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown wrapper');
  });

  it('updates a known wrapper without sudo', async () => {
    const result = await updateWrapper('git', '/tmp/bin');

    expect(result.success).toBe(true);
    expect(result.name).toBe('git');
    expect(mockFs.writeFile).toHaveBeenCalled();
  });

  it('updates a known wrapper with sudo', async () => {
    const result = await updateWrapper('git', '/usr/local/bin', undefined, true);

    expect(result.success).toBe(true);
    expect(result.message).toContain('with sudo');
  });

  it('uses provided config for content generation', async () => {
    const config = getDefaultWrapperConfig();
    config.socketPath = '/custom/socket.sock';

    const result = await updateWrapper('git', '/tmp/bin', config);

    expect(result.success).toBe(true);
    // Verify the content was generated with the custom config
    const writeCall = mockFs.writeFile.mock.calls[0];
    const content = writeCall[1] as string;
    expect(content).toContain('/custom/socket.sock');
  });
});

describe('deployInterceptor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.access.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockIsSEA.mockReturnValue(false);
    mockGetSEALibDir.mockReturnValue(null);
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

  it('handles SEA mode when source equals target', async () => {
    mockIsSEA.mockReturnValue(true);
    const hostHome = '/Users/testuser';
    mockGetSEALibDir.mockReturnValue(`${hostHome}/.agenshield/lib`);

    const result = await deployInterceptor(undefined, hostHome);

    expect(result.success).toBe(true);
    expect(result.message).toContain('already at target path');
  });

  it('handles SEA mode when source differs from target', async () => {
    mockIsSEA.mockReturnValue(true);
    mockGetSEALibDir.mockReturnValue('/opt/other/lib');

    const result = await deployInterceptor(undefined, '/Users/testuser');

    expect(result.success).toBe(true);
  });

  it('handles SEA mode when getSEALibDir returns null', async () => {
    mockIsSEA.mockReturnValue(true);
    mockGetSEALibDir.mockReturnValue(null);

    const result = await deployInterceptor(undefined, '/Users/testuser');

    // Source path will default to {baseDir}/lib/interceptor/register.cjs which equals target
    expect(result.success).toBe(true);
    expect(result.message).toContain('already at target path');
  });
});

describe('copyNodeBinary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.access.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
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

  it('returns failure when source does not exist', async () => {
    mockFs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await copyNodeBinary(undefined, '/nonexistent/node', '/Users/testuser');

    expect(result.success).toBe(false);
    expect(result.name).toBe('node-bin');
    expect(result.message).toContain('Failed to copy node binary');
  });

  it('includes dylib info when otool finds linked dylibs', async () => {
    // First few calls succeed normally. The otool call returns dylib info.
    let callCount = 0;
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('otool -L')) {
        return {
          stdout: `/usr/local/bin/node:\n\t@loader_path/../lib/libnode.127.dylib (compatibility version 127.0.0)\n`,
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await copyNodeBinary(undefined, '/usr/local/bin/node', '/Users/testuser');

    expect(result.success).toBe(true);
    // The dylib copy might fail (access check) but the main copy should succeed
  });
});

describe('copyBrokerBinary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('{"bin":{"agenshield-broker":"./dist/main.js"}}' as any);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockIsSEA.mockReturnValue(false);
    mockGetSEALibDir.mockReturnValue(null);
  });

  it('returns success in SEA mode when broker binary exists', async () => {
    mockIsSEA.mockReturnValue(true);

    const result = await copyBrokerBinary(undefined, '/Users/testuser');

    expect(result.success).toBe(true);
    expect(result.name).toBe('agenshield-broker');
    expect(result.message).toContain('SEA binary already at');
  });

  it('returns failure in SEA mode when broker binary not found', async () => {
    mockIsSEA.mockReturnValue(true);
    mockFs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await copyBrokerBinary(undefined, '/Users/testuser');

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('copies broker binary in non-SEA mode', async () => {
    const result = await copyBrokerBinary(undefined, '/Users/testuser');

    expect(result.success).toBe(true);
    expect(result.name).toBe('agenshield-broker');
    expect(result.message).toContain('Broker binary installed');
  });

  it('returns failure when broker source is not accessible', async () => {
    mockFs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await copyBrokerBinary(undefined, '/Users/testuser');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to install broker');
  });
});

describe('copyShieldClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.access.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('#!/usr/bin/env node\nconsole.log("client")' as any);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockIsSEA.mockReturnValue(false);
    mockGetSEALibDir.mockReturnValue(null);
  });

  it('installs shield-client in SEA mode', async () => {
    mockIsSEA.mockReturnValue(true);
    mockGetSEALibDir.mockReturnValue('/opt/agenshield/lib');

    const userConfig = makeUserConfig();
    const result = await copyShieldClient(userConfig, '/Users/testuser');

    expect(result.success).toBe(true);
    expect(result.name).toBe('shield-client');
    expect(result.message).toContain('SEA mode');
  });

  it('installs shield-client in non-SEA mode with shebang rewrite', async () => {
    // readFile is called twice: first for broker package.json, then for shield-client source
    mockFs.readFile
      .mockResolvedValueOnce('{"bin":{"shield-client":"./dist/client/shield-client.js"}}' as any)
      .mockResolvedValueOnce('#!/usr/bin/env node\nconsole.log("client")' as any);

    const userConfig = makeUserConfig();
    const result = await copyShieldClient(userConfig, '/Users/testuser');

    expect(result.success).toBe(true);
    expect(result.name).toBe('shield-client');
    // Verify the shebang was rewritten in the writeFile call
    const writeCall = mockFs.writeFile.mock.calls[0];
    const content = writeCall[1] as string;
    expect(content).toContain('#!/Users/agenshield_agent/bin/node-bin');
    expect(content).not.toContain('#!/usr/bin/env node');
  });

  it('returns failure when source is not accessible', async () => {
    mockFs.access.mockRejectedValue(new Error('ENOENT'));

    const userConfig = makeUserConfig();
    const result = await copyShieldClient(userConfig, '/Users/testuser');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to install shield-client');
  });

  it('handles SEA mode with getSEALibDir returning null', async () => {
    mockIsSEA.mockReturnValue(true);
    mockGetSEALibDir.mockReturnValue(null);

    const userConfig = makeUserConfig();
    const result = await copyShieldClient(userConfig, '/Users/testuser');

    expect(result.success).toBe(true);
    expect(result.message).toContain('SEA mode');
  });
});

describe('installGuardedShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('installs guarded shell successfully', async () => {
    const result = await installGuardedShell();

    expect(result.success).toBe(true);
    expect(result.name).toBe('guarded-shell');
    expect(result.message).toContain('Installed guarded shell');
  });

  it('adds shell to /etc/shells when not already present', async () => {
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('cat /etc/shells')) {
        return { stdout: '/bin/bash\n/bin/zsh\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await installGuardedShell();

    expect(result.success).toBe(true);
  });

  it('skips adding to /etc/shells when already present', async () => {
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('cat /etc/shells')) {
        return {
          stdout: '/bin/bash\n/bin/zsh\n/opt/agenshield/bin/guarded-shell\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await installGuardedShell();

    expect(result.success).toBe(true);
  });

  it('returns failure when execAsync fails', async () => {
    mockExecAsync.mockRejectedValue(new Error('sudo failed'));

    const result = await installGuardedShell();

    expect(result.success).toBe(false);
    expect(result.name).toBe('guarded-shell');
    expect(result.message).toContain('Failed to install guarded shell');
    expect(result.error).toBeDefined();
  });

  it('supports verbose logging', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    const result = await installGuardedShell(undefined, { verbose: true });

    expect(result.success).toBe(true);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});

describe('installShieldExec', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('installs shield-exec and creates symlinks successfully', async () => {
    const userConfig = makeUserConfig();
    const result = await installShieldExec(userConfig, '/tmp/bin');

    expect(result.success).toBe(true);
    expect(result.installed).toBeDefined();
    expect(result.installed!.length).toBeGreaterThan(0);
    // Should include proxied commands and node/python wrappers
    expect(result.installed).toContain('node');
    expect(result.installed).toContain('python');
    expect(result.installed).toContain('python3');
  });

  it('returns failure when execAsync fails', async () => {
    mockExecAsync.mockRejectedValue(new Error('sudo failed'));

    const userConfig = makeUserConfig();
    const result = await installShieldExec(userConfig, '/tmp/bin');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('continues when individual symlink creation fails', async () => {
    let callCount = 0;
    mockExecAsync.mockImplementation(async (cmd: string) => {
      callCount++;
      // Fail on the first rm -f (symlink removal for first command)
      if (typeof cmd === 'string' && cmd.includes('rm -f') && callCount <= 6) {
        throw new Error('rm failed');
      }
      return { stdout: '', stderr: '' };
    });

    const userConfig = makeUserConfig();
    const result = await installShieldExec(userConfig, '/tmp/bin');

    // Should still succeed overall, just some symlinks might be missing
    expect(result.installed).toBeDefined();
  });
});

describe('installAgentNvm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    // Re-establish default spawn mock for execWithProgress
    mockSpawn.mockImplementation(() => makeSpawnChild(0, 'mock output\n', ''));
  });

  it('installs NVM for agent user', async () => {
    // After execWithProgress calls (which use spawn), there are execAsync calls
    // The 'nvm which' call needs to return a node path
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('nvm which')) {
        return { stdout: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node\n', stderr: '' };
      }
      if (typeof cmd === 'string' && cmd.includes('--version')) {
        return { stdout: 'v24.0.0\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await installAgentNvm({
      agentHome: '/Users/agenshield_agent',
      agentUsername: 'agenshield_agent',
      socketGroupName: 'ash_socket',
      nodeVersion: '24',
      verbose: false,
    });

    expect(result.nvmDir).toBe('/Users/agenshield_agent/.nvm');
    expect(result.message).toBeDefined();
  });

  it('returns failure when nvm which returns empty path', async () => {
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('nvm which')) {
        return { stdout: '', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await installAgentNvm({
      agentHome: '/Users/agenshield_agent',
      agentUsername: 'agenshield_agent',
      socketGroupName: 'ash_socket',
      verbose: false,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('could not resolve node binary path');
  });

  it('returns failure when installation throws', async () => {
    mockExecAsync.mockRejectedValue(new Error('Network error'));
    mockSpawn.mockImplementation(() => makeSpawnChild(1, '', 'download failed'));

    const result = await installAgentNvm({
      agentHome: '/Users/agenshield_agent',
      agentUsername: 'agenshield_agent',
      socketGroupName: 'ash_socket',
      verbose: false,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('NVM installation failed');
    expect(result.error).toBeDefined();
  });

  it('supports verbose logging via onLog callback', async () => {
    const logs: string[] = [];
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('nvm which')) {
        return { stdout: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node\n', stderr: '' };
      }
      if (typeof cmd === 'string' && cmd.includes('--version')) {
        return { stdout: 'v24.0.0\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    await installAgentNvm({
      agentHome: '/Users/agenshield_agent',
      agentUsername: 'agenshield_agent',
      socketGroupName: 'ash_socket',
      verbose: true,
      onLog: (msg) => logs.push(msg),
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some(l => l.includes('NVM'))).toBe(true);
  });
});

describe('patchNvmNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.access.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('patches NVM node binary successfully', async () => {
    const result = await patchNvmNode({
      nodeBinaryPath: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node',
      agentUsername: 'agenshield_agent',
      socketGroupName: 'ash_socket',
      interceptorPath: '/opt/agenshield/lib/interceptor/register.cjs',
      socketPath: '/Users/agenshield_agent/.agenshield/run/agenshield.sock',
      httpPort: 5201,
      hostHome: '/Users/testuser',
    });

    expect(result.success).toBe(true);
    expect(result.name).toBe('patch-nvm-node');
    expect(result.message).toContain('Patched NVM node');
  });

  it('returns failure when node-bin is not found', async () => {
    mockFs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await patchNvmNode({
      nodeBinaryPath: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node',
      agentUsername: 'agenshield_agent',
      socketGroupName: 'ash_socket',
      interceptorPath: '/opt/agenshield/lib/interceptor/register.cjs',
      socketPath: '/Users/agenshield_agent/.agenshield/run/agenshield.sock',
      httpPort: 5201,
      hostHome: '/Users/testuser',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('node-bin not found');
    expect(result.message).toContain('copyNodeBinary must run first');
  });

  it('returns failure when sudo commands fail', async () => {
    // access succeeds but execAsync fails
    let callCount = 0;
    mockFs.access.mockResolvedValue(undefined);
    mockExecAsync.mockImplementation(async () => {
      callCount++;
      if (callCount > 1) {
        throw new Error('sudo failed');
      }
      return { stdout: '', stderr: '' };
    });

    const result = await patchNvmNode({
      nodeBinaryPath: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node',
      agentUsername: 'agenshield_agent',
      socketGroupName: 'ash_socket',
      interceptorPath: '/opt/agenshield/lib/interceptor/register.cjs',
      socketPath: '/Users/agenshield_agent/.agenshield/run/agenshield.sock',
      httpPort: 5201,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to patch NVM node');
  });

  it('supports verbose logging', async () => {
    const logs: string[] = [];

    await patchNvmNode({
      nodeBinaryPath: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node',
      agentUsername: 'agenshield_agent',
      socketGroupName: 'ash_socket',
      interceptorPath: '/opt/agenshield/lib/interceptor/register.cjs',
      socketPath: '/Users/agenshield_agent/.agenshield/run/agenshield.sock',
      httpPort: 5201,
      hostHome: '/Users/testuser',
      verbose: true,
      onLog: (msg) => logs.push(msg),
    });

    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('installBasicCommands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.access.mockResolvedValue(undefined);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('installs symlinks for all basic commands', async () => {
    const result = await installBasicCommands('/tmp/bin');

    expect(result.success).toBe(true);
    expect(result.installed.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
    // Should contain commands like ls, cat, etc.
    expect(result.installed).toContain('ls');
  });

  it('skips commands not found in any standard location', async () => {
    mockFs.access.mockRejectedValue(new Error('ENOENT'));

    const result = await installBasicCommands('/tmp/bin');

    // No commands found, but no errors either (silently skipped)
    expect(result.success).toBe(true);
    expect(result.installed).toHaveLength(0);
  });

  it('supports verbose logging', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    await installBasicCommands('/tmp/bin', { verbose: true });

    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});

describe('installPresetBinaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('{"bin":{"agenshield-broker":"./dist/main.js"}}' as any);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockSpawn.mockImplementation(() => makeSpawnChild(0, 'mock output\n', ''));
    mockIsSEA.mockReturnValue(false);
  });

  it('installs preset binaries with nvmResult provided (no interceptor-dependent bins)', async () => {
    const userConfig = makeUserConfig();
    const nvmResult = {
      success: true,
      nvmDir: '/Users/agenshield_agent/.nvm',
      nodeVersion: 'v24.0.0',
      nodeBinaryPath: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node',
      message: 'Installed',
    };

    const result = await installPresetBinaries({
      requiredBins: ['git', 'curl'],
      userConfig,
      binDir: '/tmp/bin',
      socketGroupName: 'ash_socket',
      nvmResult,
    });

    expect(result.success).toBe(true);
    expect(result.installedWrappers.length).toBeGreaterThan(0);
    expect(result.installedWrappers).toContain('git');
    expect(result.installedWrappers).toContain('curl');
  });

  it('installs preset binaries with node (interceptor deploy may fail in test env)', async () => {
    const userConfig = makeUserConfig();
    const nvmResult = {
      success: true,
      nvmDir: '/Users/agenshield_agent/.nvm',
      nodeVersion: 'v24.0.0',
      nodeBinaryPath: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node',
      message: 'Installed',
    };

    const result = await installPresetBinaries({
      requiredBins: ['node', 'git'],
      userConfig,
      binDir: '/tmp/bin',
      socketGroupName: 'ash_socket',
      nvmResult,
    });

    // node wrapper should be installed even if interceptor deploy fails
    expect(result.installedWrappers).toContain('node');
    expect(result.installedWrappers).toContain('git');
    // basic system commands should also be installed
    expect(result.installedWrappers.length).toBeGreaterThan(2);
  });

  it('installs NVM fresh when nvmResult not provided and node is required', async () => {
    const userConfig = makeUserConfig();
    // Mock for nvm which + version
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('nvm which')) {
        return {
          stdout: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node\n',
          stderr: '',
        };
      }
      if (typeof cmd === 'string' && cmd.includes('--version')) {
        return { stdout: 'v24.0.0\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const result = await installPresetBinaries({
      requiredBins: ['node', 'git'],
      userConfig,
      binDir: '/tmp/bin',
      socketGroupName: 'ash_socket',
    });

    // May have some errors from interceptor/seatbelt but wrappers should be present
    expect(result.installedWrappers).toBeDefined();
  });

  it('falls back to host node when NVM install fails', async () => {
    const userConfig = makeUserConfig();
    // Make NVM install fail
    mockSpawn.mockImplementation(() => makeSpawnChild(1, '', 'nvm install failed'));
    mockExecAsync.mockRejectedValueOnce(new Error('mkdir failed'));
    // After the first failure, reset for subsequent calls
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await installPresetBinaries({
      requiredBins: ['node'],
      userConfig,
      binDir: '/tmp/bin',
      socketGroupName: 'ash_socket',
    });

    expect(result.installedWrappers).toBeDefined();
  });

  it('installs seatbelt when python wrapper is required', async () => {
    const userConfig = makeUserConfig();
    const nvmResult = {
      success: true,
      nvmDir: '/Users/agenshield_agent/.nvm',
      nodeVersion: 'v24.0.0',
      nodeBinaryPath: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node',
      message: 'Installed',
    };

    const result = await installPresetBinaries({
      requiredBins: ['python', 'node'],
      userConfig,
      binDir: '/tmp/bin',
      socketGroupName: 'ash_socket',
      nvmResult,
    });

    expect(result.seatbeltInstalled).toBe(true);
  });

  it('deploys interceptor when node wrapper is required', async () => {
    const userConfig = makeUserConfig();
    const nvmResult = {
      success: true,
      nvmDir: '/Users/agenshield_agent/.nvm',
      nodeVersion: 'v24.0.0',
      nodeBinaryPath: '/Users/agenshield_agent/.nvm/versions/node/v24.0.0/bin/node',
      message: 'Installed',
    };

    const result = await installPresetBinaries({
      requiredBins: ['node'],
      userConfig,
      binDir: '/tmp/bin',
      socketGroupName: 'ash_socket',
      nvmResult,
    });

    // node uses interceptor, so deploying interceptor should be attempted
    expect(result.installedWrappers).toBeDefined();
  });

  it('handles lockdown errors gracefully', async () => {
    const userConfig = makeUserConfig();
    // Make the lockdown chown/chmod fail
    let chownCallCount = 0;
    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('chown -R root:')) {
        chownCallCount++;
        if (chownCallCount >= 2) {
          throw new Error('chown failed');
        }
      }
      return { stdout: '', stderr: '' };
    });

    const result = await installPresetBinaries({
      requiredBins: ['git'],
      userConfig,
      binDir: '/tmp/bin',
      socketGroupName: 'ash_socket',
    });

    // Should still return a result even if lockdown fails
    expect(result.installedWrappers).toBeDefined();
  });

  it('skips NVM node install when node is not in requiredBins', async () => {
    const userConfig = makeUserConfig();

    const result = await installPresetBinaries({
      requiredBins: ['git', 'curl'],
      userConfig,
      binDir: '/tmp/bin',
      socketGroupName: 'ash_socket',
    });

    expect(result.installedWrappers).toBeDefined();
    expect(result.success).toBe(true);
  });
});

describe('execWithProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves with stdout/stderr on success', async () => {
    mockSpawn.mockImplementation(() => makeSpawnChild(0, 'hello\n', 'warning\n'));

    const log = jest.fn();
    const result = await execWithProgress('echo hello', log);

    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('warning\n');
    expect(log).toHaveBeenCalledWith('hello');
    expect(log).toHaveBeenCalledWith('warning');
  });

  it('rejects with error on non-zero exit code', async () => {
    mockSpawn.mockImplementation(() => makeSpawnChild(1, '', 'command failed'));

    const log = jest.fn();
    await expect(
      execWithProgress('false', log),
    ).rejects.toThrow('Command failed with exit code 1');
  });

  it('filters out noise lines from log output', async () => {
    const noisy = '  % Total    % Received\nhello world\n  0  0  0  0  0  0  --:--:--\n=>\n';
    mockSpawn.mockImplementation(() => makeSpawnChild(0, noisy, ''));

    const log = jest.fn();
    await execWithProgress('curl http://example.com', log);

    // Only 'hello world' should be logged (not the curl progress lines or bare =>)
    expect(log).toHaveBeenCalledWith('hello world');
    expect(log).not.toHaveBeenCalledWith('% Total    % Received');
    expect(log).not.toHaveBeenCalledWith('=>');
  });

  it('rejects on timeout', async () => {
    // Create a child that never closes
    const child = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
      kill: jest.fn(),
    };
    mockSpawn.mockReturnValue(child);

    const log = jest.fn();
    const promise = execWithProgress('sleep 999', log, { timeout: 50 });

    await expect(promise).rejects.toThrow('Command timed out after 50ms');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects on spawn error', async () => {
    const childCallbacks: Record<string, Function[]> = {};
    const child = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on(event: string, cb: Function) {
        childCallbacks[event] = childCallbacks[event] || [];
        childCallbacks[event].push(cb);
      },
      kill: jest.fn(),
    };
    mockSpawn.mockReturnValue(child);

    const log = jest.fn();
    const promise = execWithProgress('bad-command', log);

    // Emit error
    process.nextTick(() => {
      for (const cb of childCallbacks['error'] || []) {
        cb(new Error('spawn ENOENT'));
      }
    });

    await expect(promise).rejects.toThrow('spawn ENOENT');
  });

  it('clears timeout on successful close', async () => {
    mockSpawn.mockImplementation(() => makeSpawnChild(0, 'done\n', ''));

    const log = jest.fn();
    const result = await execWithProgress('echo done', log, { timeout: 5000 });

    expect(result.stdout).toBe('done\n');
  });

  it('passes cwd and env options to spawn', async () => {
    mockSpawn.mockImplementation(() => makeSpawnChild(0, '', ''));

    const log = jest.fn();
    await execWithProgress('echo test', log, {
      cwd: '/custom/dir',
      env: { CUSTOM_VAR: 'value' },
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      '/bin/bash',
      ['-c', 'echo test'],
      expect.objectContaining({
        cwd: '/custom/dir',
        env: expect.objectContaining({ CUSTOM_VAR: 'value' }),
      }),
    );
  });
});

describe('isNoiseLine (tested via execWithProgress)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters curl progress header lines', async () => {
    mockSpawn.mockImplementation(() =>
      makeSpawnChild(0, '  % Total    % Received % Xferd\nactual output\n', ''),
    );

    const log = jest.fn();
    await execWithProgress('curl something', log);

    expect(log).toHaveBeenCalledWith('actual output');
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('% Total'));
  });

  it('filters Dload Upload lines', async () => {
    mockSpawn.mockImplementation(() =>
      makeSpawnChild(0, '  Dload  Upload   Total\nreal data\n', ''),
    );

    const log = jest.fn();
    await execWithProgress('test', log);

    expect(log).toHaveBeenCalledWith('real data');
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Dload'));
  });

  it('filters progress number rows', async () => {
    mockSpawn.mockImplementation(() =>
      makeSpawnChild(0, '0  0  0  0  0  0  --:--:--\nkeep this\n', ''),
    );

    const log = jest.fn();
    await execWithProgress('test', log);

    expect(log).toHaveBeenCalledWith('keep this');
  });

  it('filters bare arrow prompts', async () => {
    mockSpawn.mockImplementation(() =>
      makeSpawnChild(0, '=>  \n=> \nNVM installed\n', ''),
    );

    const log = jest.fn();
    await execWithProgress('test', log);

    expect(log).toHaveBeenCalledWith('NVM installed');
  });

  it('passes normal text through', async () => {
    mockSpawn.mockImplementation(() =>
      makeSpawnChild(0, 'Installing node v24.0.0\nDownload complete\n', ''),
    );

    const log = jest.fn();
    await execWithProgress('test', log);

    expect(log).toHaveBeenCalledWith('Installing node v24.0.0');
    expect(log).toHaveBeenCalledWith('Download complete');
  });
});

describe('BASIC_SYSTEM_COMMANDS', () => {
  it('is defined and non-empty', () => {
    expect(Array.isArray(BASIC_SYSTEM_COMMANDS)).toBe(true);
    expect(BASIC_SYSTEM_COMMANDS.length).toBeGreaterThan(0);
    expect(BASIC_SYSTEM_COMMANDS).toContain('ls');
    expect(BASIC_SYSTEM_COMMANDS).toContain('cat');
    expect(BASIC_SYSTEM_COMMANDS).toContain('grep');
  });
});
