/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('node:fs/promises', () => ({
  stat: jest.fn(),
  mkdir: jest.fn(),
  access: jest.fn(),
}));

/**
 * Mock node:util so that promisify(exec) returns a controllable function.
 *
 * Because jest.mock factories AND import statements are both hoisted before
 * any variable assignments, we cannot reference a module-scope variable
 * from within the factory.  Instead, we create the mock function *inside*
 * the factory and stash it on `global` so tests can access it.
 */
jest.mock('node:util', () => {
  const fn = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
  (global as any).__mockExecAsync = fn;
  return { promisify: jest.fn(() => fn) };
});

jest.mock('../../users/users', () => ({
  createUserConfig: jest.fn(() => ({
    agentUser: {
      username: 'ash_default_agent',
      uid: 5200,
      gid: 5100,
      home: '/Users/ash_default_agent',
      shell: '/Users/ash_default_agent/.agenshield/bin/guarded-shell',
      realname: 'AgenShield Agent (default)',
      groups: ['ash_default'],
    },
    brokerUser: {
      username: 'ash_default_broker',
      uid: 5201,
      gid: 5100,
      home: '/var/empty',
      shell: '/bin/bash',
      realname: 'AgenShield Broker (default)',
      groups: ['ash_default'],
    },
    groups: {
      socket: {
        name: 'ash_default',
        gid: 5100,
        description: 'AgenShield socket access (default)',
      },
    },
    prefix: '',
    baseName: 'default',
    baseUid: 5200,
    baseGid: 5100,
  })),
}));

import * as fs from 'node:fs/promises';
import {
  createDirectoryStructure,
  createPathsConfig,
  createDirectory,
  createSystemDirectories,
  createAgentDirectories,
  seedConfigFiles,
  createAllDirectories,
  verifyDirectories,
  setupSocketDirectory,
  getDirectoryInfo,
  removeAllDirectories,
} from '../../directories/directories';

// Retrieve the mock function created inside the jest.mock factory
const mockExecAsync: jest.Mock = (global as any).__mockExecAsync;
const mockStat = fs.stat as jest.MockedFunction<typeof fs.stat>;

describe('createDirectoryStructure', () => {
  it('returns agent directories with correct home path', () => {
    const structure = createDirectoryStructure();

    expect(structure.agent).toBeDefined();
    expect(structure.system).toBeDefined();

    // Check key directories exist
    const agentPaths = Object.keys(structure.agent);
    expect(agentPaths).toContain('/Users/ash_default_agent');
    expect(agentPaths).toContain('/Users/ash_default_agent/bin');
    expect(agentPaths).toContain('/Users/ash_default_agent/.zdot');
    expect(agentPaths).toContain('/Users/ash_default_agent/.agenshield');
    expect(agentPaths).toContain('/Users/ash_default_agent/.agenshield/run');
    expect(agentPaths).toContain('/Users/ash_default_agent/.agenshield/logs');
  });

  it('sets correct ownership on agent home directory', () => {
    const structure = createDirectoryStructure();
    const agentHome = structure.agent['/Users/ash_default_agent'];

    expect(agentHome).toBeDefined();
    expect(agentHome.owner).toBe('ash_default_agent');
    expect(agentHome.group).toBe('ash_default');
    expect(agentHome.mode).toBe(0o755);
  });

  it('sets broker ownership on bin directory with setgid', () => {
    const structure = createDirectoryStructure();
    const binDir = structure.agent['/Users/ash_default_agent/bin'];

    expect(binDir).toBeDefined();
    expect(binDir.owner).toBe('ash_default_broker');
    expect(binDir.group).toBe('ash_default');
    expect(binDir.mode).toBe(0o2775);
  });

  it('sets root ownership on zdot and agenshield directories', () => {
    const structure = createDirectoryStructure();
    const zdot = structure.agent['/Users/ash_default_agent/.zdot'];
    const agenshield =
      structure.agent['/Users/ash_default_agent/.agenshield'];

    expect(zdot.owner).toBe('root');
    expect(zdot.group).toBe('wheel');
    expect(agenshield.owner).toBe('root');
    expect(agenshield.group).toBe('wheel');
  });

  it('sets ACL on .openclaw directory for broker access', () => {
    const structure = createDirectoryStructure();
    const openclawDir =
      structure.agent['/Users/ash_default_agent/.openclaw'];

    expect(openclawDir).toBeDefined();
    expect(openclawDir.acl).toBeDefined();
    expect(openclawDir.acl!.length).toBeGreaterThan(0);
    expect(openclawDir.acl![0]).toContain('ash_default_broker');
  });

  it('creates tmp directory owned by agent user', () => {
    const structure = createDirectoryStructure();
    const tmpDir = structure.agent['/Users/ash_default_agent/tmp'];

    expect(tmpDir).toBeDefined();
    expect(tmpDir.owner).toBe('ash_default_agent');
    expect(tmpDir.group).toBe('ash_default');
    expect(tmpDir.mode).toBe(0o755);
  });

  it('system directories object is empty (moved to per-target)', () => {
    const structure = createDirectoryStructure();

    expect(Object.keys(structure.system)).toHaveLength(0);
  });
});

describe('createPathsConfig', () => {
  it('returns correct paths based on agent home', () => {
    const paths = createPathsConfig();

    expect(paths.socketPath).toBe(
      '/Users/ash_default_agent/.agenshield/run/agenshield.sock',
    );
    expect(paths.configDir).toBe(
      '/Users/ash_default_agent/.agenshield/config',
    );
    expect(paths.policiesDir).toBe(
      '/Users/ash_default_agent/.agenshield/policies',
    );
    expect(paths.seatbeltDir).toBe(
      '/Users/ash_default_agent/.agenshield/seatbelt',
    );
    expect(paths.logDir).toBe(
      '/Users/ash_default_agent/.agenshield/logs',
    );
    expect(paths.agentHomeDir).toBe('/Users/ash_default_agent');
    expect(paths.socketDir).toBe(
      '/Users/ash_default_agent/.agenshield/run',
    );
  });
});

describe('createDirectory', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('creates a directory with correct ownership and mode', async () => {
    const result = await createDirectory('/test/dir', {
      mode: 0o755,
      owner: 'ash_default_agent',
      group: 'ash_default',
    });

    expect(result.success).toBe(true);
    expect(result.path).toBe('/test/dir');
    expect(result.message).toBe('Created /test/dir');

    // mkdir -p, chown, chmod
    expect(mockExecAsync).toHaveBeenCalledTimes(3);
    expect(mockExecAsync).toHaveBeenCalledWith('sudo mkdir -p "/test/dir"');
    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo chown ash_default_agent:ash_default "/test/dir"',
    );
    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo chmod 755 "/test/dir"',
    );
  });

  it('returns failure result when exec throws', async () => {
    mockExecAsync.mockRejectedValue(new Error('permission denied'));

    const result = await createDirectory('/test/fail', {
      mode: 0o700,
      owner: 'root',
      group: 'wheel',
    });

    expect(result.success).toBe(false);
    expect(result.path).toBe('/test/fail');
    expect(result.message).toContain('Failed to create /test/fail');
    expect(result.message).toContain('permission denied');
    expect(result.error).toBeDefined();
  });

  it('applies ACL entries on darwin', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    try {
      const aclEntry =
        'ash_default_broker allow read,write,append,add_subdirectory';
      const result = await createDirectory('/test/acl', {
        mode: 0o2775,
        owner: 'ash_default_broker',
        group: 'ash_default',
        acl: [aclEntry],
      });

      expect(result.success).toBe(true);
      // mkdir + chown + chmod + 1 ACL entry = 4 calls
      expect(mockExecAsync).toHaveBeenCalledTimes(4);
      expect(mockExecAsync).toHaveBeenCalledWith(
        `sudo chmod -R +a '${aclEntry}' "/test/acl"`,
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

describe('createSystemDirectories', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('returns empty array because system dirs is empty', async () => {
    const results = await createSystemDirectories();

    expect(results).toEqual([]);
    // No exec calls because there are no system directories
    expect(mockExecAsync).not.toHaveBeenCalled();
  });
});

describe('createAgentDirectories', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('creates all agent directories and calls seedConfigFiles', async () => {
    const results = await createAgentDirectories();

    // Should have one result per agent directory + seedConfigFiles results
    const structure = createDirectoryStructure();
    const agentDirCount = Object.keys(structure.agent).length;

    // agentDirCount directory results + 1 seed result
    expect(results.length).toBe(agentDirCount + 1);

    // All should succeed
    expect(results.every((r) => r.success)).toBe(true);

    // First result should be the agent home
    expect(results[0].path).toBe('/Users/ash_default_agent');

    // Last result should be the seeded config file
    const lastResult = results[results.length - 1];
    expect(lastResult.path).toBe(
      '/Users/ash_default_agent/.openclaw/openclaw.json',
    );
  });
});

describe('seedConfigFiles', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('seeds openclaw.json with correct ownership', async () => {
    const results = await seedConfigFiles();

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].path).toBe(
      '/Users/ash_default_agent/.openclaw/openclaw.json',
    );
    expect(results[0].message).toContain('Seeded');

    // tee + chown + chmod = 3 calls
    expect(mockExecAsync).toHaveBeenCalledTimes(3);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('sudo tee'),
    );
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('sudo chown ash_default_broker:ash_default'),
    );
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('sudo chmod 664'),
    );
  });

  it('returns failure when seeding fails', async () => {
    mockExecAsync.mockRejectedValue(new Error('tee failed'));

    const results = await seedConfigFiles();

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].message).toContain('Failed to seed');
    expect(results[0].message).toContain('tee failed');
    expect(results[0].error).toBeDefined();
  });
});

describe('createAllDirectories', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('combines system and agent directory results', async () => {
    const results = await createAllDirectories();

    // system dirs is empty, so results = agent results only
    const structure = createDirectoryStructure();
    const agentDirCount = Object.keys(structure.agent).length;

    // 0 system + agentDirCount agent + 1 seed
    expect(results.length).toBe(agentDirCount + 1);
    expect(results.every((r) => r.success)).toBe(true);
  });
});

describe('verifyDirectories', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockStat.mockReset();
  });

  it('returns valid when all directories have correct modes', async () => {
    const structure = createDirectoryStructure();
    const allDirs = { ...structure.system, ...structure.agent };

    mockStat.mockImplementation(((dirPath: string) => {
      const expected = allDirs[dirPath as string];
      if (!expected) {
        return Promise.reject(
          Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        );
      }
      return Promise.resolve({
        isDirectory: () => true,
        mode: 0o40000 | expected.mode,
      });
    }) as any);

    const result = await verifyDirectories();

    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.incorrect).toHaveLength(0);
  });

  it('reports missing directories on ENOENT', async () => {
    mockStat.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    const result = await verifyDirectories();

    expect(result.valid).toBe(false);
    const structure = createDirectoryStructure();
    const totalDirs = Object.keys({
      ...structure.system,
      ...structure.agent,
    }).length;
    expect(result.missing).toHaveLength(totalDirs);
    expect(result.missing).toContain('/Users/ash_default_agent');
  });

  it('reports incorrect mode when modes do not match', async () => {
    mockStat.mockResolvedValue({
      isDirectory: () => true,
      // 0o40000 is S_IFDIR; mode bits 0o700 regardless of expected
      mode: 0o40700,
    } as any);

    const result = await verifyDirectories();

    // Some directories expect 0o700 so they will pass, others won't
    // At minimum directories expecting 0o755, 0o2775, 0o2770, 0o775 will be flagged
    expect(result.incorrect.length).toBeGreaterThan(0);
    const modeIssues = result.incorrect.filter((i) =>
      i.issue.includes('Mode mismatch'),
    );
    expect(modeIssues.length).toBeGreaterThan(0);
  });

  it('falls back to sudo stat on EACCES and reports mode mismatch', async () => {
    mockStat.mockRejectedValue(
      Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    );

    // sudo stat returns a mode that does not match expected
    mockExecAsync.mockResolvedValue({ stdout: '700\n', stderr: '' });

    const result = await verifyDirectories();

    // Directories with expected mode != 0o700 should be flagged as incorrect
    expect(mockExecAsync).toHaveBeenCalled();
    // At least some directories will have mismatched modes (e.g., 755 vs 700)
    const modeIssues = result.incorrect.filter((i) =>
      i.issue.includes('Mode mismatch'),
    );
    expect(modeIssues.length).toBeGreaterThan(0);
  });

  it('does not report EACCES as missing when sudo stat also fails', async () => {
    mockStat.mockRejectedValue(
      Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    );

    // sudo stat also fails
    mockExecAsync.mockRejectedValue(new Error('sudo failed'));

    const result = await verifyDirectories();

    // EACCES directories should NOT be reported as missing
    expect(result.missing).toHaveLength(0);
  });

  it('reports non-directory entries as incorrect', async () => {
    mockStat.mockResolvedValue({
      isDirectory: () => false,
      mode: 0o100755,
    } as any);

    const result = await verifyDirectories();

    expect(result.valid).toBe(false);
    const notDirIssues = result.incorrect.filter((i) =>
      i.issue.includes('Not a directory'),
    );
    expect(notDirIssues.length).toBeGreaterThan(0);
  });
});

describe('setupSocketDirectory', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('creates socket directory with correct permissions', async () => {
    const result = await setupSocketDirectory();

    expect(result.success).toBe(true);
    expect(result.path).toBe('/Users/ash_default_agent/.agenshield/run');
    expect(result.message).toBe('Socket directory configured');

    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo mkdir -p "/Users/ash_default_agent/.agenshield/run"',
    );
    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo chown ash_default_broker:ash_default "/Users/ash_default_agent/.agenshield/run"',
    );
    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo chmod 2770 "/Users/ash_default_agent/.agenshield/run"',
    );
  });

  it('returns failure when socket setup fails', async () => {
    mockExecAsync.mockRejectedValue(new Error('mkdir failed'));

    const result = await setupSocketDirectory();

    expect(result.success).toBe(false);
    expect(result.path).toBe('/Users/ash_default_agent/.agenshield/run');
    expect(result.message).toContain('Failed to setup socket directory');
    expect(result.message).toContain('mkdir failed');
    expect(result.error).toBeDefined();
  });
});

describe('getDirectoryInfo', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('parses ls -ld output into directory info', async () => {
    mockExecAsync.mockResolvedValue({
      stdout:
        'drwxr-xr-x  5 ash_default_agent  ash_default  160 Jan  1 00:00 /Users/ash_default_agent\n',
      stderr: '',
    });

    const info = await getDirectoryInfo('/Users/ash_default_agent');

    expect(info).not.toBeNull();
    expect(info!.exists).toBe(true);
    expect(info!.mode).toBe('drwxr-xr-x');
    expect(info!.owner).toBe('ash_default_agent');
    expect(info!.group).toBe('ash_default');
  });

  it('returns exists:false when ls fails', async () => {
    mockExecAsync.mockRejectedValue(
      new Error('No such file or directory'),
    );

    const info = await getDirectoryInfo('/nonexistent/path');

    expect(info).not.toBeNull();
    expect(info!.exists).toBe(false);
    expect(info!.mode).toBeUndefined();
    expect(info!.owner).toBeUndefined();
    expect(info!.group).toBeUndefined();
  });
});

describe('removeAllDirectories', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('removes agent home and legacy system directories', async () => {
    const results = await removeAllDirectories();

    // agent home + 2 legacy dirs (/etc/agenshield, /opt/agenshield)
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);

    expect(results[0].path).toBe('/Users/ash_default_agent');
    expect(results[1].path).toBe('/etc/agenshield');
    expect(results[2].path).toBe('/opt/agenshield');

    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo rm -rf "/Users/ash_default_agent"',
    );
    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo rm -rf "/etc/agenshield"',
    );
    expect(mockExecAsync).toHaveBeenCalledWith(
      'sudo rm -rf "/opt/agenshield"',
    );
  });

  it('reports failure for individual directories without stopping', async () => {
    // First call (agent home) fails, rest succeed
    mockExecAsync
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue({ stdout: '', stderr: '' });

    const results = await removeAllDirectories();

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(false);
    expect(results[0].message).toContain('busy');
    expect(results[1].success).toBe(true);
    expect(results[2].success).toBe(true);
  });
});
