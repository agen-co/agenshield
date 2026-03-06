jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  writeFileSync: jest.fn(),
}));
jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));
jest.mock('../exec/sudo', () => ({
  sudoExec: jest.fn().mockReturnValue({ success: true, output: '' }),
}));

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { sudoExec } from '../exec/sudo';
import {
  sanitizeOpenClawConfig,
  migrateNpmInstall,
  migrateGitInstall,
  migrateOpenClaw,
  createNodeWrapper,
} from '../backup/migration';
import type { SandboxUser, DirectoryStructure } from '../types';
import type { MigrationSource } from '../backup/migration';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockSudoExec = sudoExec as jest.MockedFunction<typeof sudoExec>;

function makeSandboxUser(overrides?: Partial<SandboxUser>): SandboxUser {
  return {
    username: 'agenshield_agent',
    uid: 5200,
    gid: 5100,
    homeDir: '/Users/agenshield_agent',
    shell: '/bin/bash',
    ...overrides,
  };
}

function makeDirs(overrides?: Partial<DirectoryStructure>): DirectoryStructure {
  return {
    binDir: '/Users/agenshield_agent/bin',
    wrappersDir: '/Users/agenshield_agent/bin',
    configDir: '/Users/agenshield_agent/.openclaw',
    packageDir: '/Users/agenshield_agent/openclaw',
    npmDir: '/Users/agenshield_agent/.npm',
    ...overrides,
  };
}

function makeSource(overrides?: Partial<MigrationSource>): MigrationSource {
  return {
    method: 'npm',
    packagePath: '/Users/host/.openclaw/packages/openclaw',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSudoExec.mockReturnValue({ success: true, output: '' });
  mockFs.existsSync.mockReturnValue(false);
  mockFs.writeFileSync.mockImplementation(() => undefined);
});

describe('sanitizeOpenClawConfig', () => {
  it('strips env and apiKey from skill entries', () => {
    const config = {
      skills: {
        entries: {
          'web-search': {
            enabled: true,
            env: { SERPAPI_KEY: 'sk-abc123' },
            apiKey: 'OPENAI_KEY',
          },
          'geo-optimization': {
            enabled: true,
            env: { GEO_TOKEN: 'tok-xyz' },
          },
        },
      },
    };

    const result = sanitizeOpenClawConfig(config);
    const entries = (result['skills'] as Record<string, unknown>)['entries'] as Record<
      string,
      Record<string, unknown>
    >;

    expect(entries['web-search']).toEqual({ enabled: true });
    expect(entries['geo-optimization']).toEqual({ enabled: true });
    expect(entries['web-search']).not.toHaveProperty('env');
    expect(entries['web-search']).not.toHaveProperty('apiKey');
    expect(entries['geo-optimization']).not.toHaveProperty('env');
  });

  it('preserves non-secret skill config fields', () => {
    const config = {
      skills: {
        allowBundled: ['gemini', 'peekaboo'],
        load: { extraDirs: ['/custom/skills'] },
        install: { preferBrew: true, nodeManager: 'npm' },
        entries: {
          gog: {
            enabled: true,
            env: { GOG_KEY: 'xxx' },
            timeout: 30000,
            maxRetries: 3,
          },
        },
      },
    };

    const result = sanitizeOpenClawConfig(config);
    const skills = result['skills'] as Record<string, unknown>;
    const entries = skills['entries'] as Record<string, Record<string, unknown>>;

    // Non-secret fields preserved
    expect(entries['gog']).toEqual({ enabled: true, timeout: 30000, maxRetries: 3 });
    expect(entries['gog']).not.toHaveProperty('env');

    // Sibling skill config keys preserved
    expect(skills['allowBundled']).toEqual(['gemini', 'peekaboo']);
    expect(skills['load']).toEqual({ extraDirs: ['/custom/skills'] });
    expect(skills['install']).toEqual({ preferBrew: true, nodeManager: 'npm' });
  });

  it('preserves all top-level sections', () => {
    const config = {
      identity: { name: 'MyBot', emoji: '🤖' },
      agent: { workspace: '~/projects' },
      channels: { telegram: { token: '...' } },
      gateway: { port: 3000 },
      env: { OPENROUTER_API_KEY: 'or-xxx' },
      logging: { level: 'info' },
      skills: {
        entries: {
          test: { enabled: true, apiKey: 'KEY' },
        },
      },
    };

    const result = sanitizeOpenClawConfig(config);

    // All top-level keys preserved
    expect(result['identity']).toEqual({ name: 'MyBot', emoji: '🤖' });
    expect(result['agent']).toEqual({ workspace: '~/projects' });
    expect(result['channels']).toEqual({ telegram: { token: '...' } });
    expect(result['gateway']).toEqual({ port: 3000 });
    expect(result['logging']).toEqual({ level: 'info' });

    // Top-level env is NOT stripped (only skill-level env is)
    expect(result['env']).toEqual({ OPENROUTER_API_KEY: 'or-xxx' });

    // Skill apiKey is stripped
    const entries = (result['skills'] as Record<string, unknown>)['entries'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(entries['test']).toEqual({ enabled: true });
    expect(entries['test']).not.toHaveProperty('apiKey');
  });

  it('passes through settings unchanged', () => {
    // No settings at all
    const result1 = sanitizeOpenClawConfig({});
    expect(result1['settings']).toBeUndefined();

    // Existing settings preserved as-is
    const result2 = sanitizeOpenClawConfig({ settings: { foo: 'bar' } });
    expect(result2['settings']).toEqual({ foo: 'bar' });
  });

  it('handles empty and missing skills gracefully', () => {
    // Empty config
    const result1 = sanitizeOpenClawConfig({});
    expect(result1['settings']).toBeUndefined();

    // skills key with no entries
    const result2 = sanitizeOpenClawConfig({ skills: {} });
    expect(result2['skills']).toEqual({});

    // skills with empty entries
    const result3 = sanitizeOpenClawConfig({ skills: { entries: {} } });
    const entries = (result3['skills'] as Record<string, unknown>)['entries'] as Record<
      string,
      unknown
    >;
    expect(entries).toEqual({});
  });

  it('does NOT mutate the input object', () => {
    const config = {
      skills: {
        entries: {
          'web-search': {
            enabled: true,
            env: { SERPAPI_KEY: 'sk-abc123' },
            apiKey: 'OPENAI_KEY',
          },
        },
      },
      settings: { existing: true },
    };

    // Deep-clone to compare later
    const original = JSON.parse(JSON.stringify(config));

    sanitizeOpenClawConfig(config);

    // Input must be identical to the snapshot taken before the call
    expect(config).toEqual(original);
  });

  it('handles a full real-world config', () => {
    const config = {
      identity: { name: 'ProdBot', emoji: '🛡️', version: '2.1.0' },
      agent: { workspace: '~/workspace', maxConcurrency: 4 },
      channels: {
        telegram: { token: 'tg-token-123', chatId: '-100123' },
        slack: { botToken: 'xoxb-slack-token', channel: '#general' },
      },
      auth: { providers: ['github', 'google'], sessionTtl: 3600 },
      session: { store: 'redis', ttl: 86400 },
      tools: { enabled: ['search', 'calculator', 'code-runner'] },
      models: {
        default: 'gpt-4',
        fallback: 'gpt-3.5-turbo',
        providers: { openai: { apiKey: 'sk-model-key' } },
      },
      skills: {
        allowBundled: ['gemini'],
        load: { extraDirs: ['/opt/skills'] },
        install: { nodeManager: 'pnpm' },
        entries: {
          'web-search': {
            enabled: true,
            env: { SERPAPI_KEY: 'sk-serp-real' },
            apiKey: 'OPENAI_KEY_REAL',
            timeout: 15000,
          },
          summarizer: {
            enabled: true,
            env: { SUMMARY_MODEL: 'gpt-4' },
            maxTokens: 4096,
          },
          translator: {
            enabled: false,
            apiKey: 'DEEPL_KEY',
            languages: ['en', 'es', 'fr'],
          },
          'code-runner': {
            enabled: true,
            sandbox: true,
          },
        },
      },
      logging: { level: 'debug', file: '/var/log/openclaw.log' },
      gateway: { port: 3000, host: '0.0.0.0', cors: true },
      env: {
        OPENROUTER_API_KEY: 'or-xxx',
        DATABASE_URL: 'postgres://localhost:5432/openclaw',
      },
      settings: { theme: 'dark', notifications: true },
    };

    const result = sanitizeOpenClawConfig(config);

    // Top-level sections pass through unchanged
    expect(result['identity']).toEqual(config.identity);
    expect(result['agent']).toEqual(config.agent);
    expect(result['channels']).toEqual(config.channels);
    expect(result['auth']).toEqual(config.auth);
    expect(result['session']).toEqual(config.session);
    expect(result['tools']).toEqual(config.tools);
    expect(result['models']).toEqual(config.models);
    expect(result['logging']).toEqual(config.logging);
    expect(result['gateway']).toEqual(config.gateway);
    expect(result['env']).toEqual(config.env);

    // Skills structure preserved except secrets
    const skills = result['skills'] as Record<string, unknown>;
    expect(skills['allowBundled']).toEqual(['gemini']);
    expect(skills['load']).toEqual({ extraDirs: ['/opt/skills'] });
    expect(skills['install']).toEqual({ nodeManager: 'pnpm' });

    const entries = skills['entries'] as Record<string, Record<string, unknown>>;

    // web-search: env + apiKey stripped, timeout kept
    expect(entries['web-search']).toEqual({ enabled: true, timeout: 15000 });

    // summarizer: env stripped, maxTokens kept
    expect(entries['summarizer']).toEqual({ enabled: true, maxTokens: 4096 });

    // translator: apiKey stripped, languages kept
    expect(entries['translator']).toEqual({ enabled: false, languages: ['en', 'es', 'fr'] });

    // code-runner: no secrets to strip, passes through intact
    expect(entries['code-runner']).toEqual({ enabled: true, sandbox: true });

    // Settings passed through unchanged
    expect(result['settings']).toEqual({
      theme: 'dark',
      notifications: true,
    });
  });
});

describe('migrateNpmInstall', () => {
  it('succeeds when all steps complete', () => {
    mockSudoExec.mockReturnValue({ success: true, output: '' });
    // existsSync returns false for configDir check (skip chown on configDir)
    mockFs.existsSync.mockReturnValue(false);

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({ method: 'npm' });

    const result = migrateNpmInstall(source, user, dirs);

    expect(result.success).toBe(true);
    expect(result.newPaths).toBeDefined();
    expect(result.newPaths!.packagePath).toBe(dirs.packageDir);
    expect(result.newPaths!.binaryPath).toBe('/Users/agenshield_agent/bin/openclaw');
    expect(result.newPaths!.configPath).toBe(dirs.configDir);
  });

  it('fails when packageDir is not configured', () => {
    const user = makeSandboxUser();
    const dirs = makeDirs({ packageDir: undefined });
    const source = makeSource({ method: 'npm' });

    const result = migrateNpmInstall(source, user, dirs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('packageDir');
  });

  it('fails when copy fails', () => {
    mockSudoExec.mockReturnValueOnce({ success: false, error: 'Permission denied' });

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({ method: 'npm' });

    const result = migrateNpmInstall(source, user, dirs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to copy package');
  });

  it('fails when ownership chown fails', () => {
    // Trace through migrateNpmInstall sudoExec calls:
    // 1: cp -R (sudoCopyDir for package)
    // 2: mkdir -p (copyConfigAndSanitize creates configDir)
    // 3: mkdir -p (copyConfigAndSanitize creates skills subdir, since no configPath)
    // 4: chown -R on packageDir -- THIS should fail
    let callCount = 0;
    mockSudoExec.mockImplementation(() => {
      callCount++;
      if (callCount === 4) {
        return { success: false, error: 'chown failed' };
      }
      return { success: true, output: '' };
    });
    mockFs.existsSync.mockReturnValue(false);

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({ method: 'npm' });

    const result = migrateNpmInstall(source, user, dirs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('ownership');
  });

  it('fails when wrapper creation fails', () => {
    // All sudoExec calls succeed except the wrapper mv step
    let callCount = 0;
    mockSudoExec.mockImplementation(() => {
      callCount++;
      // Calls: 1=cp package, 2=mkdir config, 3=chown package, 4=mv wrapper
      if (callCount === 4) {
        return { success: false, error: 'mv failed' };
      }
      return { success: true, output: '' };
    });
    mockFs.existsSync.mockReturnValue(false);

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({ method: 'npm' });

    const result = migrateNpmInstall(source, user, dirs);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('migrateGitInstall', () => {
  it('succeeds when all steps complete', () => {
    mockSudoExec.mockReturnValue({ success: true, output: '' });
    mockFs.existsSync.mockReturnValue(false);

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({
      method: 'git',
      gitRepoPath: '/Users/host/git/openclaw',
    });

    const result = migrateGitInstall(source, user, dirs);

    expect(result.success).toBe(true);
    expect(result.newPaths).toBeDefined();
    expect(result.newPaths!.packagePath).toBe(dirs.packageDir);
    expect(result.newPaths!.binaryPath).toBe('/Users/agenshield_agent/bin/openclaw');
  });

  it('fails when packageDir is not configured', () => {
    const user = makeSandboxUser();
    const dirs = makeDirs({ packageDir: undefined });
    const source = makeSource({ method: 'git' });

    const result = migrateGitInstall(source, user, dirs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('packageDir');
  });

  it('fails when repo copy fails', () => {
    mockSudoExec.mockReturnValueOnce({ success: false, error: 'copy error' });

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({ method: 'git' });

    const result = migrateGitInstall(source, user, dirs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to copy repo');
  });

  it('uses packagePath when gitRepoPath is not set', () => {
    mockSudoExec.mockReturnValue({ success: true, output: '' });
    mockFs.existsSync.mockReturnValue(false);

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({
      method: 'git',
      packagePath: '/Users/host/projects/openclaw',
    });

    const result = migrateGitInstall(source, user, dirs);

    expect(result.success).toBe(true);
    // The first sudoExec call should use packagePath as source
    expect(mockSudoExec).toHaveBeenCalledWith(
      expect.stringContaining('/Users/host/projects/openclaw'),
    );
  });
});

describe('migrateOpenClaw', () => {
  it('routes npm method to migrateNpmInstall', () => {
    mockSudoExec.mockReturnValue({ success: true, output: '' });
    mockFs.existsSync.mockReturnValue(false);

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({ method: 'npm' });

    const result = migrateOpenClaw(source, user, dirs);

    expect(result.success).toBe(true);
    expect(result.newPaths).toBeDefined();
  });

  it('routes git method to migrateGitInstall', () => {
    mockSudoExec.mockReturnValue({ success: true, output: '' });
    mockFs.existsSync.mockReturnValue(false);

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({
      method: 'git',
      gitRepoPath: '/Users/host/git/openclaw',
    });

    const result = migrateOpenClaw(source, user, dirs);

    expect(result.success).toBe(true);
    expect(result.newPaths).toBeDefined();
  });

  it('propagates npm install failure', () => {
    mockSudoExec.mockReturnValueOnce({ success: false, error: 'denied' });

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({ method: 'npm' });

    const result = migrateOpenClaw(source, user, dirs);

    expect(result.success).toBe(false);
  });

  it('propagates git install failure', () => {
    mockSudoExec.mockReturnValueOnce({ success: false, error: 'denied' });

    const user = makeSandboxUser();
    const dirs = makeDirs();
    const source = makeSource({ method: 'git' });

    const result = migrateOpenClaw(source, user, dirs);

    expect(result.success).toBe(false);
  });
});

describe('createNodeWrapper', () => {
  it('finds node at /opt/agenshield/bin/node-bin', () => {
    mockFs.existsSync.mockImplementation((p) => {
      return p === '/opt/agenshield/bin/node-bin';
    });
    mockSudoExec.mockReturnValue({ success: true, output: '' });

    const user = makeSandboxUser();
    const dirs = makeDirs();

    const result = createNodeWrapper(user, dirs);

    expect(result.success).toBe(true);
    // The wrapper content should reference the sandboxNodeBin path
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/node-wrapper',
      expect.stringContaining('/opt/agenshield/bin/node-bin'),
      expect.anything(),
    );
  });

  it('finds node via NVM when sandbox binary not available', () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (p === '/opt/agenshield/bin/node-bin') return false;
      if (typeof p === 'string' && p.includes('.nvm/versions/node/v20.0.0/bin/node')) return true;
      return false;
    });
    mockFs.readdirSync.mockReturnValue(['v18.0.0', 'v20.0.0'] as unknown as fs.Dirent[]);
    mockSudoExec.mockReturnValue({ success: true, output: '' });

    const user = makeSandboxUser();
    const dirs = makeDirs();

    const result = createNodeWrapper(user, dirs);

    expect(result.success).toBe(true);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/node-wrapper',
      expect.stringContaining('v20.0.0'),
      expect.anything(),
    );
  });

  it('finds node via system which when NVM not available', () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('no such directory');
    });
    mockExecSync.mockReturnValue('/usr/local/bin/node\n');
    mockSudoExec.mockReturnValue({ success: true, output: '' });

    const user = makeSandboxUser();
    const dirs = makeDirs();

    const result = createNodeWrapper(user, dirs);

    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith('which node', { encoding: 'utf-8' });
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/node-wrapper',
      expect.stringContaining('/usr/local/bin/node'),
      expect.anything(),
    );
  });

  it('fails when node is not found anywhere', () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error('no such directory');
    });
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const user = makeSandboxUser();
    const dirs = makeDirs();

    const result = createNodeWrapper(user, dirs);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Node.js not found');
  });
});
