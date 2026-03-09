import { spawnSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  statSync: jest.fn(),
}));

jest.mock('../../exec/sudo', () => ({
  sudoExec: jest.fn().mockReturnValue({ success: true, output: '' }),
}));

jest.mock('../../shell/guarded-shell', () => ({
  GUARDED_SHELL_CONTENT: '#!/bin/zsh\n# mock',
  guardedShellPath: (home: string) => `${home}/.agenshield/bin/guarded-shell`,
}));

// Mock node:util so that promisify(exec) returns a wrapper that delegates
// to mockExecAsync. The wrapper is needed because jest.mock factories run
// before variable assignments, so mockExecAsync is undefined at factory time.
// The wrapper captures calls lazily, forwarding to mockExecAsync at call time.
// eslint-disable-next-line no-var
var mockExecAsync: jest.Mock;

jest.mock('node:util', () => ({
  promisify: jest.fn(
    () =>
      (...args: unknown[]) =>
        mockExecAsync(...args),
  ),
}));

// Must import AFTER mocks
import {
  createUserConfig,
  DEFAULT_BASE_UID,
  DEFAULT_BASE_GID,
  DEFAULT_BASE_NAME,
  ASH_PREFIX,
  groupExists,
  userExists,
  createGroup,
  createGroups,
  createUser,
  createAgentUser,
  createBrokerUser,
  createUsers,
  createAllUsersAndGroups,
  deleteGroup,
  deleteUser,
  deleteGroups,
  deleteUsers,
  deleteAllUsersAndGroups,
  getUserInfo,
  getGroupInfo,
  verifyUsersAndGroups,
  isAgenshieldUser,
  listAgenshieldUsers,
  discoverOrphanedEntities,
} from '../../users/users';

import {
  userExistsSync,
  deleteSandboxUser,
} from '../../legacy';

import { sudoExec } from '../../exec/sudo';

// Initialize mockExecAsync now that execution has reached regular code
mockExecAsync = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });

const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedSudoExec = sudoExec as jest.MockedFunction<typeof sudoExec>;
const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockedReaddirSync = fs.readdirSync as jest.Mock;
const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

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

// ---------------------------------------------------------------------------
// Async function tests (using mockExecAsync)
// ---------------------------------------------------------------------------

/** Reset mockExecAsync: clear history + once-queue, then re-set default. */
function resetExecAsync() {
  mockExecAsync.mockClear();
  // Remove any pending once-values by replacing the implementation entirely
  mockExecAsync.mockImplementation(() =>
    Promise.resolve({ stdout: '', stderr: '' }),
  );
}

describe('groupExists', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('returns true when dscl read succeeds', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: 'PrimaryGroupID: 5100', stderr: '' });

    const result = await groupExists('ash_default');

    expect(result).toBe(true);
    expect(mockExecAsync).toHaveBeenCalledWith('dscl . -read /Groups/ash_default');
  });

  it('returns false when dscl read rejects', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const result = await groupExists('nonexistent_group');

    expect(result).toBe(false);
  });
});

describe('userExists', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('returns true when dscl read succeeds', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: 'UniqueID: 5200', stderr: '' });

    const result = await userExists('ash_default_agent');

    expect(result).toBe(true);
    expect(mockExecAsync).toHaveBeenCalledWith('dscl . -read /Users/ash_default_agent');
  });

  it('returns false when dscl read rejects', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const result = await userExists('nonexistent_user');

    expect(result).toBe(false);
  });
});

describe('createGroup', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('returns early when group already exists', async () => {
    // First call is groupExists check - resolve to indicate group exists
    mockExecAsync.mockResolvedValueOnce({ stdout: 'PrimaryGroupID: 5100', stderr: '' });

    const result = await createGroup('ash_default', 5100, 'Socket group');

    expect(result.success).toBe(true);
    expect(result.message).toContain('already exists');
    // Only one call (the groupExists check)
    expect(mockExecAsync).toHaveBeenCalledTimes(1);
  });

  it('creates group when it does not exist', async () => {
    // groupExists check rejects (group doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    // Subsequent calls succeed (create, PrimaryGroupID, RealName, Password)
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await createGroup('ash_default', 5100, 'Socket group');

    expect(result.success).toBe(true);
    expect(result.message).toContain('Created group ash_default');
    // 1 (groupExists) + 4 (create, PrimaryGroupID, RealName, Password)
    expect(mockExecAsync).toHaveBeenCalledTimes(5);
    expect(mockExecAsync).toHaveBeenCalledWith('sudo dscl . -create /Groups/ash_default');
    expect(mockExecAsync).toHaveBeenCalledWith('sudo dscl . -create /Groups/ash_default PrimaryGroupID 5100');
  });

  it('returns failure when dscl create rejects', async () => {
    // groupExists check rejects (group doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    // Create call fails
    mockExecAsync.mockRejectedValueOnce(new Error('permission denied'));

    const result = await createGroup('ash_default', 5100);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to create group');
    expect(result.error).toBeInstanceOf(Error);
  });

  it('uses group name as RealName when description is not provided', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    await createGroup('ash_custom', 5100);

    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo dscl . -create /Groups/ash_custom RealName "ash_custom"',
    );
  });
});

describe('createGroups', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('creates the socket group from config', async () => {
    // groupExists check rejects (doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const config = createUserConfig();
    const results = await createGroups(config);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('/Groups/ash_default'),
    );
  });

  it('uses default config when none is provided', async () => {
    // groupExists check resolves (already exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });

    const results = await createGroups();

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].message).toContain('ash_default');
  });
});

describe('createUser', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('returns early when user already exists', async () => {
    // userExists check resolves (user exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'UniqueID: 5200', stderr: '' });

    const config = createUserConfig();
    const result = await createUser(config.agentUser);

    expect(result.success).toBe(true);
    expect(result.message).toContain('already exists');
    expect(mockExecAsync).toHaveBeenCalledTimes(1);
  });

  it('creates user with home directory and marker for agent user', async () => {
    // userExists check rejects (user doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    // All subsequent calls succeed
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const config = createUserConfig();
    const result = await createUser(config.agentUser);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Created user ash_default_agent');
    // Should create dscl entries, add to groups, mkdir, chown, chmod, marker
    expect(mockExecAsync).toHaveBeenCalledWith('sudo dscl . -create /Users/ash_default_agent');
    expect(mockExecAsync).toHaveBeenCalledWith(
      `sudo dscl . -create /Users/ash_default_agent UniqueID ${DEFAULT_BASE_UID}`,
    );
    expect(mockExecAsync).toHaveBeenCalledWith(
      `sudo dscl . -create /Users/ash_default_agent PrimaryGroupID ${DEFAULT_BASE_GID}`,
    );
    expect(mockExecAsync).toHaveBeenCalledWith('sudo mkdir -p /Users/ash_default_agent');
    expect(mockExecAsync).toHaveBeenCalledWith(
      `sudo chown ash_default_agent:${DEFAULT_BASE_GID} /Users/ash_default_agent`,
    );
    expect(mockExecAsync).toHaveBeenCalledWith('sudo chmod 755 /Users/ash_default_agent');
    // Marker directory
    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo mkdir -p /Users/ash_default_agent/.agenshield',
    );
  });

  it('skips home directory creation for broker user (home is /var/empty)', async () => {
    // userExists check rejects (user doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const config = createUserConfig();
    const result = await createUser(config.brokerUser);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Created user ash_default_broker');
    // Should NOT have mkdir for /var/empty
    expect(mockExecAsync).not.toHaveBeenCalledWith('sudo mkdir -p /var/empty');
  });

  it('returns failure when dscl create rejects', async () => {
    // userExists check rejects (user doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    // create call fails
    mockExecAsync.mockRejectedValueOnce(new Error('permission denied'));

    const config = createUserConfig();
    const result = await createUser(config.agentUser);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to create user');
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('createAgentUser', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('delegates to createUser with agent user definition', async () => {
    // userExists resolves (already exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });

    const config = createUserConfig();
    const result = await createAgentUser(config);

    expect(result.success).toBe(true);
    expect(result.message).toContain('ash_default_agent');
  });

  it('uses default config when none is provided', async () => {
    // userExists resolves (already exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });

    const result = await createAgentUser();

    expect(result.success).toBe(true);
    expect(result.message).toContain('ash_default_agent');
  });
});

describe('createBrokerUser', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('delegates to createUser with broker user definition', async () => {
    // userExists resolves (already exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });

    const config = createUserConfig();
    const result = await createBrokerUser(config);

    expect(result.success).toBe(true);
    expect(result.message).toContain('ash_default_broker');
  });

  it('uses default config when none is provided', async () => {
    // userExists resolves (already exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });

    const result = await createBrokerUser();

    expect(result.success).toBe(true);
    expect(result.message).toContain('ash_default_broker');
  });
});

describe('createUsers', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('creates both agent and broker users', async () => {
    // Both userExists checks resolve (both already exist)
    mockExecAsync
      .mockResolvedValueOnce({ stdout: 'exists', stderr: '' })  // agent exists
      .mockResolvedValueOnce({ stdout: 'exists', stderr: '' }); // broker exists

    const config = createUserConfig();
    const results = await createUsers(config);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[0].message).toContain('ash_default_agent');
    expect(results[1].success).toBe(true);
    expect(results[1].message).toContain('ash_default_broker');
  });
});

describe('createAllUsersAndGroups', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('creates groups then users', async () => {
    // groupExists resolves (already exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // agent userExists resolves (already exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // broker userExists resolves (already exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });

    const config = createUserConfig();
    const result = await createAllUsersAndGroups(config);

    expect(result.groups).toHaveLength(1);
    expect(result.users).toHaveLength(2);
    expect(result.groups[0].success).toBe(true);
    expect(result.users[0].success).toBe(true);
    expect(result.users[1].success).toBe(true);
  });
});

describe('deleteGroup', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('returns success when group does not exist', async () => {
    // groupExists check rejects (group doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const result = await deleteGroup('ash_default');

    expect(result.success).toBe(true);
    expect(result.message).toContain('does not exist');
  });

  it('deletes group when it exists', async () => {
    // groupExists check resolves (group exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // delete succeeds
    mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await deleteGroup('ash_default');

    expect(result.success).toBe(true);
    expect(result.message).toContain('Deleted group ash_default');
    expect(mockExecAsync).toHaveBeenCalledWith('sudo dscl . -delete /Groups/ash_default');
  });

  it('returns failure when dscl delete rejects', async () => {
    // groupExists check resolves (group exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // delete fails
    mockExecAsync.mockRejectedValueOnce(new Error('permission denied'));

    const result = await deleteGroup('ash_default');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to delete group');
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('deleteUser', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('returns success when user does not exist', async () => {
    // userExists check rejects (user doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const result = await deleteUser('ash_default_agent');

    expect(result.success).toBe(true);
    expect(result.message).toContain('does not exist');
  });

  it('deletes user and cleans up marker when user exists with home dir', async () => {
    // userExists check resolves (user exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // getUserInfo call resolves with home dir
    mockExecAsync.mockResolvedValueOnce({
      stdout: 'NFSHomeDirectory: /Users/ash_default_agent\nUniqueID: 5200',
      stderr: '',
    });
    // dscl delete succeeds
    mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // rm -rf marker succeeds
    mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await deleteUser('ash_default_agent');

    expect(result.success).toBe(true);
    expect(result.message).toContain('Deleted user ash_default_agent');
    expect(mockExecAsync).toHaveBeenCalledWith('sudo dscl . -delete /Users/ash_default_agent');
    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo rm -rf /Users/ash_default_agent/.agenshield',
    );
  });

  it('skips marker cleanup for /var/empty home', async () => {
    // userExists check resolves
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // getUserInfo call resolves with /var/empty home
    mockExecAsync.mockResolvedValueOnce({
      stdout: 'NFSHomeDirectory: /var/empty\nUniqueID: 5201',
      stderr: '',
    });
    // dscl delete succeeds
    mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await deleteUser('ash_default_broker');

    expect(result.success).toBe(true);
    expect(mockExecAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('rm -rf /var/empty'),
    );
  });

  it('returns failure when dscl delete rejects', async () => {
    // userExists check resolves (user exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // getUserInfo rejects (best effort)
    mockExecAsync.mockRejectedValueOnce(new Error('lookup failed'));
    // dscl delete fails
    mockExecAsync.mockRejectedValueOnce(new Error('permission denied'));

    const result = await deleteUser('ash_default_agent');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to delete user');
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('deleteGroups', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('deletes the socket group from config', async () => {
    // groupExists rejects (doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const config = createUserConfig();
    const results = await deleteGroups(config);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  it('uses default config when none is provided', async () => {
    // groupExists rejects (doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const results = await deleteGroups();

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].message).toContain('ash_default');
  });
});

describe('deleteUsers', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('deletes both agent and broker users', async () => {
    // agent userExists rejects (doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    // broker userExists rejects (doesn't exist)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const config = createUserConfig();
    const results = await deleteUsers(config);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[0].message).toContain('ash_default_agent');
    expect(results[1].success).toBe(true);
    expect(results[1].message).toContain('ash_default_broker');
  });
});

describe('deleteAllUsersAndGroups', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('deletes users first then groups', async () => {
    // agent userExists rejects
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    // broker userExists rejects
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    // groupExists rejects
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const config = createUserConfig();
    const result = await deleteAllUsersAndGroups(config);

    expect(result.users).toHaveLength(2);
    expect(result.groups).toHaveLength(1);
    expect(result.users[0].success).toBe(true);
    expect(result.users[1].success).toBe(true);
    expect(result.groups[0].success).toBe(true);
  });
});

describe('getUserInfo', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('parses dscl output into key-value record', async () => {
    mockExecAsync.mockResolvedValueOnce({
      stdout: [
        'UniqueID: 5200',
        'PrimaryGroupID: 5100',
        'NFSHomeDirectory: /Users/ash_default_agent',
        'UserShell: /bin/bash',
        'RealName: AgenShield Agent (default)',
      ].join('\n'),
      stderr: '',
    });

    const info = await getUserInfo('ash_default_agent');

    expect(info).not.toBeNull();
    expect(info!['UniqueID']).toBe('5200');
    expect(info!['PrimaryGroupID']).toBe('5100');
    expect(info!['NFSHomeDirectory']).toBe('/Users/ash_default_agent');
    expect(info!['UserShell']).toBe('/bin/bash');
    expect(info!['RealName']).toBe('AgenShield Agent (default)');
  });

  it('returns null when dscl read rejects', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const info = await getUserInfo('nonexistent');

    expect(info).toBeNull();
  });

  it('handles empty output', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const info = await getUserInfo('ash_default_agent');

    expect(info).not.toBeNull();
    expect(Object.keys(info!)).toHaveLength(0);
  });

  it('ignores lines without a colon separator', async () => {
    mockExecAsync.mockResolvedValueOnce({
      stdout: 'UniqueID: 5200\nno-colon-here\nRealName: Agent',
      stderr: '',
    });

    const info = await getUserInfo('ash_default_agent');

    expect(info).not.toBeNull();
    expect(Object.keys(info!)).toHaveLength(2);
    expect(info!['UniqueID']).toBe('5200');
    expect(info!['RealName']).toBe('Agent');
  });
});

describe('getGroupInfo', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('parses dscl output into key-value record', async () => {
    mockExecAsync.mockResolvedValueOnce({
      stdout: [
        'PrimaryGroupID: 5100',
        'RealName: AgenShield socket access (default)',
        'Password: *',
      ].join('\n'),
      stderr: '',
    });

    const info = await getGroupInfo('ash_default');

    expect(info).not.toBeNull();
    expect(info!['PrimaryGroupID']).toBe('5100');
    expect(info!['RealName']).toBe('AgenShield socket access (default)');
    expect(info!['Password']).toBe('*');
    expect(mockExecAsync).toHaveBeenCalledWith('dscl . -read /Groups/ash_default');
  });

  it('returns null when dscl read rejects', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const info = await getGroupInfo('nonexistent');

    expect(info).toBeNull();
  });
});

describe('verifyUsersAndGroups', () => {
  beforeEach(() => {
    resetExecAsync();
  });

  it('returns valid when all entities exist', async () => {
    // groupExists for ash_default resolves
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // userExists for ash_default_agent resolves
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });
    // userExists for ash_default_broker resolves
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });

    const config = createUserConfig();
    const result = await verifyUsersAndGroups(config);

    expect(result.valid).toBe(true);
    expect(result.missingGroups).toHaveLength(0);
    expect(result.missingUsers).toHaveLength(0);
  });

  it('reports missing groups and users', async () => {
    // groupExists for ash_default rejects (missing)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    // userExists for ash_default_agent rejects (missing)
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    // userExists for ash_default_broker resolves (exists)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'exists', stderr: '' });

    const config = createUserConfig();
    const result = await verifyUsersAndGroups(config);

    expect(result.valid).toBe(false);
    expect(result.missingGroups).toContain('ash_default');
    expect(result.missingUsers).toContain('ash_default_agent');
    expect(result.missingUsers).not.toContain('ash_default_broker');
  });

  it('reports all missing when nothing exists', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));
    mockExecAsync.mockRejectedValueOnce(new Error('No such key'));

    const result = await verifyUsersAndGroups();

    expect(result.valid).toBe(false);
    expect(result.missingGroups).toHaveLength(1);
    expect(result.missingUsers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Sync function tests
// ---------------------------------------------------------------------------

describe('isAgenshieldUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it('returns true when .agenshield/meta.json exists', () => {
    mockedExistsSync.mockReturnValue(true);

    expect(isAgenshieldUser('ash_default_agent')).toBe(true);
    expect(mockedExistsSync).toHaveBeenCalledWith(
      '/Users/ash_default_agent/.agenshield/meta.json',
    );
  });

  it('returns false when marker file does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(isAgenshieldUser('ash_default_agent')).toBe(false);
  });

  it('returns false when existsSync throws', () => {
    mockedExistsSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    expect(isAgenshieldUser('ash_default_agent')).toBe(false);
  });
});

describe('listAgenshieldUsers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReaddirSync.mockReturnValue([]);
    mockedExistsSync.mockReturnValue(false);
  });

  it('returns empty array when no ash_ directories exist', () => {
    mockedReaddirSync.mockReturnValue([]);

    const result = listAgenshieldUsers();

    expect(result).toEqual([]);
  });

  it('returns users with metadata when marker exists', () => {
    const meta = {
      createdAt: '2026-01-01T00:00:00Z',
      version: '1.0',
      username: 'ash_default_agent',
      uid: 5200,
    };

    mockedReaddirSync.mockReturnValue([
      { name: 'ash_default_agent', isDirectory: () => true },
      { name: 'ash_default_broker', isDirectory: () => true },
      { name: 'regular_user', isDirectory: () => true },
    ]);
    mockedReadFileSync
      .mockReturnValueOnce(JSON.stringify(meta))
      .mockImplementationOnce(() => { throw new Error('ENOENT'); });

    const result = listAgenshieldUsers();

    // Should only include ash_ prefixed entries
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe('ash_default_agent');
    expect(result[0].meta).toEqual(meta);
    expect(result[1].username).toBe('ash_default_broker');
    expect(result[1].meta).toBeNull();
  });

  it('includes user with null meta when meta.json is invalid JSON', () => {
    mockedReaddirSync.mockReturnValue([
      { name: 'ash_test_agent', isDirectory: () => true },
    ]);
    mockedReadFileSync.mockReturnValue('not-json');

    const result = listAgenshieldUsers();

    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('ash_test_agent');
    expect(result[0].meta).toBeNull();
  });

  it('skips non-directory entries', () => {
    mockedReaddirSync.mockReturnValue([
      { name: 'ash_default_agent', isDirectory: () => false },
    ]);

    const result = listAgenshieldUsers();

    expect(result).toEqual([]);
  });

  it('returns empty array when readdirSync throws', () => {
    mockedReaddirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = listAgenshieldUsers();

    expect(result).toEqual([]);
  });
});

describe('discoverOrphanedEntities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReaddirSync.mockReturnValue([]);
    mockedExecSync.mockReturnValue('');
    mockedExistsSync.mockReturnValue(false);
    mockedStatSync.mockReturnValue({ isDirectory: () => false } as any);
  });

  it('returns empty array when no ash_ entities exist anywhere', () => {
    mockedReaddirSync.mockReturnValue([]);
    mockedExecSync.mockReturnValue('');

    const result = discoverOrphanedEntities();

    expect(result).toEqual([]);
  });

  it('discovers entities from filesystem scan', () => {
    mockedReaddirSync.mockReturnValue([
      { name: 'ash_default_agent', isDirectory: () => true },
    ]);
    mockedExecSync.mockReturnValue('');
    // existsSync for home dir check
    mockedExistsSync.mockReturnValue(true);
    mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);
    // readFileSync for meta.json
    const meta = {
      createdAt: '2026-01-01T00:00:00Z',
      version: '1.0',
      username: 'ash_default_agent',
      uid: 5200,
    };
    mockedReadFileSync.mockReturnValue(JSON.stringify(meta));

    const result = discoverOrphanedEntities();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ash_default_agent');
    expect(result[0].hasHomeDir).toBe(true);
    expect(result[0].hasDsclUser).toBe(false);
    expect(result[0].hasDsclGroup).toBe(false);
    expect(result[0].verified).toBe(true);
    expect(result[0].meta).toEqual(meta);
  });

  it('discovers entities from dscl users', () => {
    mockedReaddirSync.mockReturnValue([]);
    mockedExecSync
      .mockReturnValueOnce('root\nash_default_agent\nnobody\n')  // dscl users
      .mockReturnValueOnce('');  // dscl groups
    mockedExistsSync.mockReturnValue(false);

    const result = discoverOrphanedEntities();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ash_default_agent');
    expect(result[0].hasDsclUser).toBe(true);
    expect(result[0].hasDsclGroup).toBe(false);
    expect(result[0].hasHomeDir).toBe(false);
  });

  it('discovers entities from dscl groups', () => {
    mockedReaddirSync.mockReturnValue([]);
    mockedExecSync
      .mockReturnValueOnce('')  // dscl users
      .mockReturnValueOnce('wheel\nash_default\nstaff\n');  // dscl groups
    mockedExistsSync.mockReturnValue(false);

    const result = discoverOrphanedEntities();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ash_default');
    expect(result[0].hasDsclUser).toBe(false);
    expect(result[0].hasDsclGroup).toBe(true);
    expect(result[0].hasHomeDir).toBe(false);
  });

  it('merges all three sources and deduplicates', () => {
    // Filesystem has ash_default_agent
    mockedReaddirSync.mockReturnValue([
      { name: 'ash_default_agent', isDirectory: () => true },
    ]);
    // dscl users also has ash_default_agent + ash_default_broker
    mockedExecSync
      .mockReturnValueOnce('ash_default_agent\nash_default_broker\n')  // dscl users
      .mockReturnValueOnce('ash_default\nash_default_agent\n');  // dscl groups
    // existsSync + statSync for home dir checks
    mockedExistsSync.mockImplementation((p: string) => {
      if (p === '/Users/ash_default_agent') return true;
      if (p === '/Users/ash_default_broker') return false;
      if (p === '/Users/ash_default') return false;
      return false;
    });
    mockedStatSync.mockImplementation((p: string) => {
      if (p === '/Users/ash_default_agent') {
        return { isDirectory: () => true } as any;
      }
      return { isDirectory: () => false } as any;
    });
    // readFileSync for meta.json
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = discoverOrphanedEntities();

    // Unique names: ash_default_agent, ash_default_broker, ash_default
    expect(result).toHaveLength(3);

    const agentEntity = result.find(e => e.name === 'ash_default_agent');
    expect(agentEntity).toBeDefined();
    expect(agentEntity!.hasDsclUser).toBe(true);
    expect(agentEntity!.hasDsclGroup).toBe(true);
    expect(agentEntity!.hasHomeDir).toBe(true);
    expect(agentEntity!.verified).toBe(false); // meta.json read failed

    const brokerEntity = result.find(e => e.name === 'ash_default_broker');
    expect(brokerEntity).toBeDefined();
    expect(brokerEntity!.hasDsclUser).toBe(true);
    expect(brokerEntity!.hasDsclGroup).toBe(false);
    expect(brokerEntity!.hasHomeDir).toBe(false);

    const groupEntity = result.find(e => e.name === 'ash_default');
    expect(groupEntity).toBeDefined();
    expect(groupEntity!.hasDsclUser).toBe(false);
    expect(groupEntity!.hasDsclGroup).toBe(true);
    expect(groupEntity!.hasHomeDir).toBe(false);
  });

  it('handles dscl failures gracefully', () => {
    mockedReaddirSync.mockReturnValue([]);
    mockedExecSync.mockImplementation(() => {
      throw new Error('command not found');
    });

    const result = discoverOrphanedEntities();

    expect(result).toEqual([]);
  });

  it('handles filesystem failures gracefully', () => {
    mockedReaddirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    mockedExecSync.mockReturnValue('ash_default_agent\n');

    // Called once for dscl users, once for dscl groups (which also finds it)
    // existsSync for /Users/ash_default_agent
    mockedExistsSync.mockReturnValue(false);

    const result = discoverOrphanedEntities();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ash_default_agent');
    expect(result[0].hasDsclUser).toBe(true);
  });

  it('sets verified to true and includes meta when marker exists', () => {
    mockedReaddirSync.mockReturnValue([
      { name: 'ash_test_agent', isDirectory: () => true },
    ]);
    mockedExecSync.mockReturnValue('');
    mockedExistsSync.mockReturnValue(true);
    mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);

    const meta = {
      createdAt: '2026-03-01T00:00:00Z',
      version: '1.0',
      username: 'ash_test_agent',
      uid: 5200,
    };
    mockedReadFileSync.mockReturnValue(JSON.stringify(meta));

    const result = discoverOrphanedEntities();

    expect(result).toHaveLength(1);
    expect(result[0].verified).toBe(true);
    expect(result[0].meta).toEqual(meta);
  });

  it('sets verified to false when meta.json is missing', () => {
    mockedReaddirSync.mockReturnValue([
      { name: 'ash_test_agent', isDirectory: () => true },
    ]);
    mockedExecSync.mockReturnValue('');
    mockedExistsSync.mockReturnValue(true);
    mockedStatSync.mockReturnValue({ isDirectory: () => true } as any);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = discoverOrphanedEntities();

    expect(result).toHaveLength(1);
    expect(result[0].verified).toBe(false);
    expect(result[0].meta).toBeNull();
  });
});
