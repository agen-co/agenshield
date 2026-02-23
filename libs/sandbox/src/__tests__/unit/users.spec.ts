import { spawnSync, execSync } from 'node:child_process';

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
}));

jest.mock('../../exec/sudo', () => ({
  sudoExec: jest.fn().mockReturnValue({ success: true, output: '' }),
}));

jest.mock('../../shell/guarded-shell', () => ({
  GUARDED_SHELL_CONTENT: '#!/bin/zsh\n# mock',
  guardedShellPath: (home: string) => `${home}/.agenshield/bin/guarded-shell`,
}));

// Must import AFTER mocks
import {
  createUserConfig,
  DEFAULT_BASE_UID,
  DEFAULT_BASE_GID,
  DEFAULT_BASE_NAME,
  ASH_PREFIX,
} from '../../users/users';

import {
  userExistsSync,
  deleteSandboxUser,
} from '../../legacy';

import { sudoExec } from '../../exec/sudo';

const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedSudoExec = sudoExec as jest.MockedFunction<typeof sudoExec>;

describe('createUserConfig', () => {
  it('generates correct default naming (ash_default_agent)', () => {
    const config = createUserConfig();

    expect(config.agentUser.username).toBe('ash_default_agent');
    expect(config.brokerUser.username).toBe('ash_default_broker');
    expect(config.groups.socket.name).toBe('ash_default');
    expect(config.agentUser.home).toBe('/Users/ash_default_agent');
    expect(config.agentUser.uid).toBe(DEFAULT_BASE_UID);
    expect(config.agentUser.gid).toBe(DEFAULT_BASE_GID);
    expect(config.baseName).toBe(DEFAULT_BASE_NAME);
  });

  it('generates correct naming with custom baseName (ash_myapp_agent)', () => {
    const config = createUserConfig({ baseName: 'myapp' });

    expect(config.agentUser.username).toBe('ash_myapp_agent');
    expect(config.brokerUser.username).toBe('ash_myapp_broker');
    expect(config.groups.socket.name).toBe('ash_myapp');
    expect(config.agentUser.home).toBe('/Users/ash_myapp_agent');
    expect(config.baseName).toBe('myapp');
  });

  it('adds prefix to all names when prefix option is provided', () => {
    const config = createUserConfig({ prefix: 'test' });

    expect(config.agentUser.username).toBe('test_ash_default_agent');
    expect(config.brokerUser.username).toBe('test_ash_default_broker');
    expect(config.groups.socket.name).toBe('test_ash_default');
    expect(config.agentUser.home).toBe('/Users/test_ash_default_agent');
    expect(config.prefix).toBe('test');
  });

  it('uses custom UIDs and GIDs', () => {
    const config = createUserConfig({ baseUid: 6200, baseGid: 6100 });

    expect(config.agentUser.uid).toBe(6200);
    expect(config.brokerUser.uid).toBe(6201);
    expect(config.agentUser.gid).toBe(6100);
    expect(config.groups.socket.gid).toBe(6100);
    expect(config.baseUid).toBe(6200);
    expect(config.baseGid).toBe(6100);
  });

  it('combines prefix and baseName correctly', () => {
    const config = createUserConfig({ prefix: 'test1', baseName: 'myapp' });

    expect(config.agentUser.username).toBe('test1_ash_myapp_agent');
    expect(config.brokerUser.username).toBe('test1_ash_myapp_broker');
    expect(config.groups.socket.name).toBe('test1_ash_myapp');
  });

  it('broker user has /var/empty home and /bin/bash shell', () => {
    const config = createUserConfig();

    expect(config.brokerUser.home).toBe('/var/empty');
    expect(config.brokerUser.shell).toBe('/bin/bash');
  });

  it('agent user groups contain the socket group name', () => {
    const config = createUserConfig();

    expect(config.agentUser.groups).toContain('ash_default');
  });

  it('agent user shell is the per-target guarded-shell path', () => {
    const config = createUserConfig();

    expect(config.agentUser.shell).toBe(
      '/Users/ash_default_agent/.agenshield/bin/guarded-shell',
    );
  });
});

describe('userExistsSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when dscl succeeds (status 0)', () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 1,
      signal: null,
      output: [],
    });

    expect(userExistsSync('ash_default_agent')).toBe(true);
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'dscl',
      ['.', '-read', '/Users/ash_default_agent'],
      expect.any(Object),
    );
  });

  it('returns false when dscl fails (non-zero status)', () => {
    mockedSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'Not Found',
      pid: 1,
      signal: null,
      output: [],
    });

    expect(userExistsSync('nonexistent')).toBe(false);
  });
});

describe('deleteSandboxUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSudoExec.mockReturnValue({ success: true, output: '' });
  });

  it('returns success immediately if user does not exist', () => {
    mockedSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '',
      pid: 1,
      signal: null,
      output: [],
    });

    const result = deleteSandboxUser('nonexistent');

    expect(result).toEqual({ success: true });
    expect(mockedSudoExec).not.toHaveBeenCalled();
  });

  it('calls dscl delete for user and group', () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 1,
      signal: null,
      output: [],
    });
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = deleteSandboxUser('ash_default_agent');

    expect(result).toEqual({ success: true });
    expect(mockedSudoExec).toHaveBeenCalledWith(
      'dscl . -delete /Users/ash_default_agent',
    );
    expect(mockedSudoExec).toHaveBeenCalledWith(
      'dscl . -delete /Groups/ash_default_agent',
    );
  });

  it('returns failure when dscl delete fails', () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 1,
      signal: null,
      output: [],
    });
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedSudoExec.mockReturnValueOnce({
      success: false,
      error: 'access denied',
    });

    const result = deleteSandboxUser('ash_default_agent');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to delete user');
  });
});
