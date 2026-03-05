jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('node:fs/promises', () => ({
  stat: jest.fn(),
  mkdir: jest.fn(),
}));

jest.mock('node:util', () => ({
  promisify: jest.fn(() =>
    jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  ),
}));

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

import {
  createDirectoryStructure,
  createPathsConfig,
} from '../../directories/directories';

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
