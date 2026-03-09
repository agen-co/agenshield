jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  mkdirSync: jest.fn(),
  copyFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  chmodSync: jest.fn(),
  unlinkSync: jest.fn(),
  rmSync: jest.fn(),
}));

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import {
  getSkillsDir,
  getAgenCoSkillPath,
  generateSkillWrapperScript,
  injectAgenCoSkill,
  createAgenCoSymlink,
  removeInjectedSkills,
  updateOpenClawMcpConfig,
} from '../../inject/skill-injector';
import type { UserConfig } from '@agenshield/ipc';

const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockedWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;
const mockedMkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>;
const mockedRmSync = fs.rmSync as jest.MockedFunction<typeof fs.rmSync>;
const mockedUnlinkSync = fs.unlinkSync as jest.MockedFunction<typeof fs.unlinkSync>;
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    agentUser: {
      username: 'ash_default_agent',
      uid: 501,
      gid: 501,
      shell: '/bin/bash',
      home: '/Users/ash_default_agent',
    },
    brokerUser: {
      username: 'ash_default_broker',
      uid: 502,
      gid: 502,
      shell: '/bin/bash',
      home: '/Users/ash_default_broker',
    },
    groups: {
      socket: { name: 'ash_default', gid: 600, description: 'Socket group' },
    },
    prefix: '',
    baseName: 'agenshield',
    baseUid: 500,
    baseGid: 600,
    ...overrides,
  };
}

describe('getSkillsDir', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns correct path based on home directory', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = getSkillsDir('/Users/ash_default_agent');

    expect(result).toBe(
      '/Users/ash_default_agent/.openclaw/workspace/skills',
    );
  });

  it('prefers .openclaw/workspace/skills when parent exists', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/agent/.openclaw/workspace';
    });

    const result = getSkillsDir('/Users/agent');

    expect(result).toBe('/Users/agent/.openclaw/workspace/skills');
  });

  it('falls back to .config/openclaw/skills when it exists', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === '/Users/agent/.config/openclaw') return true;
      return false;
    });

    const result = getSkillsDir('/Users/agent');

    expect(result).toBe('/Users/agent/.config/openclaw/skills');
  });

  it('returns first default path when nothing exists', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = getSkillsDir('/Users/nobody');

    expect(result).toContain('.openclaw/workspace/skills');
  });

  it('returns .claude/skills path when presetId is claude-code', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = getSkillsDir('/Users/testuser', 'claude-code');

    expect(result).toBe('/Users/testuser/.claude/skills');
  });

  it('ignores filesystem checks for claude-code preset', () => {
    mockedExistsSync.mockReturnValue(true);

    const result = getSkillsDir('/Users/testuser', 'claude-code');

    expect(result).toBe('/Users/testuser/.claude/skills');
    // existsSync should not have been called since claude-code returns early
    expect(mockedExistsSync).not.toHaveBeenCalled();
  });
});

describe('getAgenCoSkillPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when skill is not found at any path', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(() => getAgenCoSkillPath()).toThrow('AgenCo skill not found');
  });

  it('returns path when SKILL.md exists at primary location', () => {
    const originalEnv = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/Users/ash_default_agent';

    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) ===
        '/Users/ash_default_agent/.openclaw/workspace/skills/agenco/SKILL.md';
    });

    const result = getAgenCoSkillPath();

    expect(result).toBe(
      '/Users/ash_default_agent/.openclaw/workspace/skills/agenco',
    );

    process.env['AGENSHIELD_AGENT_HOME'] = originalEnv;
  });

  it('falls back to /opt/agenshield/skills/agenco', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/opt/agenshield/skills/agenco/SKILL.md';
    });

    const result = getAgenCoSkillPath();

    expect(result).toBe('/opt/agenshield/skills/agenco');
  });
});

describe('generateSkillWrapperScript', () => {
  it('returns a bash script with correct env vars', () => {
    const script = generateSkillWrapperScript(
      'test-skill',
      '/path/to/bin/test.js',
    );

    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('AGENSHIELD_CONTEXT_TYPE=skill');
    expect(script).toContain('AGENSHIELD_SKILL_SLUG=test-skill');
    expect(script).toContain('exec "/path/to/bin/test.js" "$@"');
  });

  it('includes the skill slug in the comment', () => {
    const script = generateSkillWrapperScript(
      'agenco',
      '/skills/agenco/bin/agenco.js',
    );

    expect(script).toContain('skill wrapper for: agenco');
  });

  it('passes through all arguments with $@', () => {
    const script = generateSkillWrapperScript('skill', '/bin/skill');

    expect(script).toContain('"$@"');
  });
});

describe('injectAgenCoSkill', () => {
  const config = makeConfig();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('copies skill and returns success when skill source exists', async () => {
    const originalEnv = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/Users/ash_default_agent';

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      // getAgenCoSkillPath needs SKILL.md to exist
      if (s === '/Users/ash_default_agent/.claude/skills/agenco/SKILL.md') return true;
      // copyDirRecursive: dest does not exist initially
      if (s.includes('/.openclaw/workspace/skills/agenco')) return false;
      // Skills dir does not exist yet
      if (s.includes('/.openclaw/workspace/skills')) return false;
      // No package.json, no dist dir
      if (s.includes('package.json') || s.includes('/dist')) return false;
      // No bin path
      if (s.includes('bin/agenco.js')) return false;
      return false;
    });

    // readdirSync for copyDirRecursive
    (fs.readdirSync as jest.Mock).mockReturnValue([]);

    const result = await injectAgenCoSkill(config);

    expect(result.success).toBe(true);
    expect(result.injectedSkills).toContain('agenco');
    expect(mockedMkdirSync).toHaveBeenCalled();

    process.env['AGENSHIELD_AGENT_HOME'] = originalEnv;
  });

  it('returns failure when getAgenCoSkillPath throws', async () => {
    mockedExistsSync.mockReturnValue(false);
    delete process.env['AGENSHIELD_AGENT_HOME'];

    const result = await injectAgenCoSkill(config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('AgenCo skill not found');
    expect(result.injectedSkills).toHaveLength(0);
  });

  it('makes bin script executable when it exists', async () => {
    const originalEnv = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/Users/ash_default_agent';

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/ash_default_agent/.claude/skills/agenco/SKILL.md') return true;
      // bin/agenco.js exists
      if (s.endsWith('bin/agenco.js')) return true;
      return false;
    });
    (fs.readdirSync as jest.Mock).mockReturnValue([]);

    await injectAgenCoSkill(config);

    expect(fs.chmodSync).toHaveBeenCalledWith(
      expect.stringContaining('bin/agenco.js'),
      0o755,
    );

    process.env['AGENSHIELD_AGENT_HOME'] = originalEnv;
  });

  it('builds skill when package.json exists but dist does not', async () => {
    const originalEnv = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/Users/ash_default_agent';

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/ash_default_agent/.claude/skills/agenco/SKILL.md') return true;
      if (s.endsWith('package.json')) return true;
      if (s.endsWith('/dist')) return false;
      return false;
    });
    (fs.readdirSync as jest.Mock).mockReturnValue([]);

    await injectAgenCoSkill(config);

    expect(mockedExecSync).toHaveBeenCalledWith(
      'npm install && npm run build',
      expect.objectContaining({ cwd: expect.stringContaining('agenco') }),
    );

    process.env['AGENSHIELD_AGENT_HOME'] = originalEnv;
  });
});

describe('createAgenCoSymlink', () => {
  const config = makeConfig();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates wrapper script with correct content', async () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      // Wrapper does not exist yet
      if (s === '/usr/local/bin/agenco') return false;
      return false;
    });

    const result = await createAgenCoSymlink(config, '/usr/local/bin');

    expect(result.success).toBe(true);
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      '/usr/local/bin/agenco',
      expect.stringContaining('AGENSHIELD_CONTEXT_TYPE=skill'),
      { mode: 0o755 },
    );
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      '/usr/local/bin/agenco',
      expect.stringContaining('AGENSHIELD_SKILL_SLUG=agenco'),
      { mode: 0o755 },
    );
  });

  it('removes existing wrapper before creating new one', async () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      if (String(p) === '/usr/local/bin/agenco') return true;
      return false;
    });

    const result = await createAgenCoSymlink(config, '/usr/local/bin');

    expect(result.success).toBe(true);
    expect(mockedUnlinkSync).toHaveBeenCalledWith('/usr/local/bin/agenco');
  });

  it('returns failure when writeFileSync throws', async () => {
    mockedExistsSync.mockReturnValue(false);
    mockedWriteFileSync.mockImplementationOnce(() => {
      throw new Error('Permission denied');
    });

    const result = await createAgenCoSymlink(config, '/usr/local/bin');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });
});

describe('removeInjectedSkills', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('removes agenco directory when it exists', async () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith('/agenco')) return true;
      // getSkillsDir path parent check
      if (s.includes('.openclaw/workspace')) return true;
      return false;
    });

    const result = await removeInjectedSkills('/Users/ash_default_agent');

    expect(result.success).toBe(true);
    expect(mockedRmSync).toHaveBeenCalledWith(
      expect.stringContaining('/agenco'),
      { recursive: true, force: true },
    );
  });

  it('is a no-op when agenco directory does not exist', async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await removeInjectedSkills('/Users/ash_default_agent');

    expect(result.success).toBe(true);
    expect(mockedRmSync).not.toHaveBeenCalled();
  });

  it('returns failure when rmSync throws', async () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      if (String(p).endsWith('/agenco')) return true;
      return false;
    });
    mockedRmSync.mockImplementationOnce(() => {
      throw new Error('EPERM: operation not permitted');
    });

    const result = await removeInjectedSkills('/Users/ash_default_agent');

    expect(result.success).toBe(false);
    expect(result.error).toContain('EPERM');
  });
});

describe('updateOpenClawMcpConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates new config when no existing config is found', async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await updateOpenClawMcpConfig('/Users/testuser');

    expect(result.success).toBe(true);
    // Should create the config directory
    expect(mockedMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.openclaw'),
      expect.objectContaining({ recursive: true }),
    );
    // Should write config with agenco-marketplace
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('mcp.json'),
      expect.stringContaining('agenco-marketplace'),
      expect.objectContaining({ mode: 0o644 }),
    );
  });

  it('updates existing config preserving other mcpServers', async () => {
    const existingConfig = {
      mcpServers: {
        'other-server': { url: 'https://other.example.com' },
      },
      someOtherKey: 'preserved',
    };

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith('mcp.json')) return true;
      // Config directory exists
      if (s.endsWith('.openclaw')) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(existingConfig));

    const result = await updateOpenClawMcpConfig('/Users/testuser');

    expect(result.success).toBe(true);

    const writtenJson = (mockedWriteFileSync.mock.calls[0][1] as string);
    const parsed = JSON.parse(writtenJson);

    // Existing server preserved
    expect(parsed.mcpServers['other-server']).toBeDefined();
    expect(parsed.mcpServers['other-server'].url).toBe('https://other.example.com');
    // AgenCo server added
    expect(parsed.mcpServers['agenco-marketplace']).toBeDefined();
    expect(parsed.mcpServers['agenco-marketplace'].transport).toBe('sse');
    // Other keys preserved
    expect(parsed.someOtherKey).toBe('preserved');
    // skillWatcher added
    expect(parsed.skillWatcher).toBeDefined();
    expect(parsed.skillWatcher.enabled).toBe(true);
  });

  it('adds mcpServers property when existing config has none', async () => {
    const existingConfig = { someKey: 'value' };

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith('mcp.json')) return true;
      if (s.endsWith('.openclaw')) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(existingConfig));

    const result = await updateOpenClawMcpConfig('/Users/testuser');

    expect(result.success).toBe(true);

    const writtenJson = (mockedWriteFileSync.mock.calls[0][1] as string);
    const parsed = JSON.parse(writtenJson);

    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers['agenco-marketplace']).toBeDefined();
  });

  it('prefers existing .config/openclaw/mcp.json when it exists', async () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      // First path does NOT exist
      if (s === '/Users/testuser/.openclaw/mcp.json') return false;
      // Second path exists
      if (s === '/Users/testuser/.config/openclaw/mcp.json') return true;
      // Config dir exists
      if (s === '/Users/testuser/.config/openclaw') return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue('{}');

    const result = await updateOpenClawMcpConfig('/Users/testuser');

    expect(result.success).toBe(true);
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      '/Users/testuser/.config/openclaw/mcp.json',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('returns failure when readFileSync throws on existing config', async () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith('mcp.json')) return true;
      if (s.endsWith('.openclaw')) return true;
      return false;
    });
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = await updateOpenClawMcpConfig('/Users/testuser');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  it('returns failure when writeFileSync throws', async () => {
    mockedExistsSync.mockReturnValue(false);
    mockedWriteFileSync.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    const result = await updateOpenClawMcpConfig('/Users/testuser');

    expect(result.success).toBe(false);
    expect(result.error).toContain('ENOSPC');
  });
});
