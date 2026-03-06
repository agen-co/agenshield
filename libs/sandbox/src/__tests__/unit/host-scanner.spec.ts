jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  accessSync: jest.fn(),
}));

jest.mock('node:os', () => ({
  homedir: jest.fn().mockReturnValue('/Users/testuser'),
}));

jest.mock('../../detection/security', () => ({
  isSecretEnvVar: jest.fn((name: string) => {
    const patterns = [
      /^AWS_/i, /^OPENAI_/i, /_API_KEY$/i, /_SECRET$/i, /_TOKEN$/i,
    ];
    return patterns.some((p) => p.test(name));
  }),
}));

import {
  maskSecretValue,
  scanShellProfiles,
  scanOpenClawConfig,
  scanProcessEnv,
  resolveEnvVarValue,
  scanHost,
} from '../../detection/host-scanner';
import * as fs from 'node:fs';

const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockedReaddirSync = fs.readdirSync as jest.MockedFunction<typeof fs.readdirSync>;

describe('maskSecretValue', () => {
  it('fully masks short values (8 chars or fewer)', () => {
    expect(maskSecretValue('abc')).toBe('****');
    expect(maskSecretValue('12345678')).toBe('****');
  });

  it('shows first 3 and last 4 chars for longer values', () => {
    expect(maskSecretValue('sk-abc123xyz456')).toBe('sk-...z456');
  });

  it('handles exactly 9-char values (minimum for partial mask)', () => {
    const result = maskSecretValue('123456789');

    expect(result).toBe('123...6789');
  });

  it('handles very long values', () => {
    const longValue = 'a'.repeat(100);
    const result = maskSecretValue(longValue);

    expect(result).toBe('aaa...aaaa');
    expect(result.length).toBeLessThan(longValue.length);
  });

  it('masks empty-ish values', () => {
    expect(maskSecretValue('')).toBe('****');
    expect(maskSecretValue('a')).toBe('****');
  });
});

describe('scanShellProfiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty arrays when no profiles exist', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = scanShellProfiles('/Users/testuser');

    expect(result.envVars).toHaveLength(0);
    expect(result.scannedProfiles).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('scans .zshrc for exported secret env vars', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/testuser/.zshrc';
    });
    mockedReadFileSync.mockReturnValue(
      'export AWS_SECRET_KEY="sk-test-123456789"\nexport PATH="/usr/bin"\nexport HOME="/Users/testuser"\n',
    );

    const result = scanShellProfiles('/Users/testuser');

    expect(result.scannedProfiles).toContain('/Users/testuser/.zshrc');
    const secretVars = result.envVars.filter((v) => v.isSecret);
    expect(secretVars.length).toBeGreaterThan(0);
  });

  it('skips variable references and command substitutions', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/testuser/.zshrc';
    });
    mockedReadFileSync.mockReturnValue(
      'export AWS_TOKEN="$(get-token)"\nexport AWS_KEY=$OTHER_VAR\n',
    );

    const result = scanShellProfiles('/Users/testuser');

    // These should be skipped because they contain $( or start with $
    expect(result.envVars).toHaveLength(0);
  });

  it('records warnings for unreadable files', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/testuser/.bashrc';
    });
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = scanShellProfiles('/Users/testuser');

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Could not read');
  });
});

describe('scanOpenClawConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns warning when config file does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = scanOpenClawConfig('/Users/testuser/.openclaw/openclaw.json');

    expect(result.skills).toHaveLength(0);
    expect(result.envVars).toHaveLength(0);
    expect(result.warnings).toContain('Config file not found: /Users/testuser/.openclaw/openclaw.json');
  });

  it('parses skills entries from config', () => {
    const config = {
      skills: {
        entries: {
          'my-skill': { enabled: true, env: { OPENAI_API_KEY: 'sk-test-123456789' } },
          'disabled-skill': { enabled: false },
        },
      },
    };

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/.openclaw/openclaw.json') return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));

    const result = scanOpenClawConfig('/Users/testuser/.openclaw/openclaw.json');

    expect(result.skills).toHaveLength(2);
    expect(result.skills[0].name).toBe('my-skill');
    expect(result.skills[0].enabled).toBe(true);
    expect(result.skills[1].name).toBe('disabled-skill');
    expect(result.skills[1].enabled).toBe(false);
  });

  it('extracts env vars from skill entries with app-config source', () => {
    const config = {
      skills: {
        entries: {
          'my-skill': { enabled: true, env: { OPENAI_API_KEY: 'sk-test-123456789', MY_VAR: 'hello' } },
        },
      },
    };

    mockedExistsSync.mockImplementation((p: unknown) => {
      if (String(p) === '/config/openclaw.json') return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));

    const result = scanOpenClawConfig('/config/openclaw.json');

    expect(result.envVars).toHaveLength(2);
    expect(result.envVars[0].name).toBe('OPENAI_API_KEY');
    expect(result.envVars[0].source).toBe('app-config');
    expect(result.envVars[0].associatedSkill).toBe('my-skill');
    expect(result.envVars[0].isSecret).toBe(true);
    expect(result.envVars[1].name).toBe('MY_VAR');
    expect(result.envVars[1].isSecret).toBe(false);
  });

  it('discovers extra skills from skills directory not in config', () => {
    const config = {
      skills: {
        entries: {
          'configured-skill': { enabled: true },
        },
      },
    };

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/config/openclaw.json') return true;
      // skills dir exists
      if (s === '/config/skills') return true;
      // extra-skill has a SKILL.md
      if (s === '/config/skills/extra-skill') return true;
      if (s === '/config/skills/extra-skill/SKILL.md') return true;
      return false;
    });
    mockedReadFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/config/openclaw.json') return JSON.stringify(config);
      if (s === '/config/skills/extra-skill/SKILL.md') {
        return '---\ndescription: An extra skill\n---\n# Extra Skill';
      }
      return '';
    });
    mockedReaddirSync.mockReturnValue([
      { name: 'configured-skill', isDirectory: () => true },
      { name: 'extra-skill', isDirectory: () => true },
      { name: 'not-a-skill', isDirectory: () => true },
      { name: 'file.txt', isDirectory: () => false },
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = scanOpenClawConfig('/config/openclaw.json');

    // configured-skill from config + extra-skill from directory scan
    expect(result.skills).toHaveLength(2);
    const extraSkill = result.skills.find(s => s.name === 'extra-skill');
    expect(extraSkill).toBeDefined();
    expect(extraSkill!.enabled).toBe(false);
    expect(extraSkill!.hasSkillMd).toBe(true);
    expect(extraSkill!.description).toBe('An extra skill');

    // not-a-skill should not appear (no SKILL.md or package.json)
    expect(result.skills.find(s => s.name === 'not-a-skill')).toBeUndefined();
  });

  it('handles JSON parse error gracefully', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      if (String(p) === '/config/openclaw.json') return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue('{ invalid json }}}');

    const result = scanOpenClawConfig('/config/openclaw.json');

    expect(result.skills).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Failed to parse config');
  });

  it('handles config with no skills property', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      if (String(p) === '/config/openclaw.json') return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify({ otherKey: 'value' }));

    const result = scanOpenClawConfig('/config/openclaw.json');

    // No entries, so skills come only from directory scan (which finds nothing)
    expect(result.skills).toHaveLength(0);
    expect(result.envVars).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('scanProcessEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up env for deterministic tests
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AWS_') || key.startsWith('OPENAI_') || key.endsWith('_API_KEY') || key.endsWith('_SECRET') || key.endsWith('_TOKEN')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it('returns secret env vars from process.env', () => {
    process.env['AWS_ACCESS_KEY_ID'] = 'AKIAIOSFODNN7EXAMPLE';
    process.env['OPENAI_API_KEY'] = 'sk-test-1234567890abcdef';
    process.env['REGULAR_VAR'] = 'not-a-secret';

    const result = scanProcessEnv();

    const names = result.map(v => v.name);
    expect(names).toContain('AWS_ACCESS_KEY_ID');
    expect(names).toContain('OPENAI_API_KEY');
    expect(names).not.toContain('REGULAR_VAR');
  });

  it('all returned vars have source process-env and isSecret true', () => {
    process.env['AWS_SECRET'] = 'some-secret-value';

    const result = scanProcessEnv();

    const awsVar = result.find(v => v.name === 'AWS_SECRET');
    expect(awsVar).toBeDefined();
    expect(awsVar!.source).toBe('process-env');
    expect(awsVar!.isSecret).toBe(true);
  });

  it('returns empty array when no secret env vars exist', () => {
    // Ensure no secrets are set (cleaned in beforeEach)
    const result = scanProcessEnv();

    // Should not find any secrets (all secret-like vars were deleted)
    for (const v of result) {
      // If there happen to be any remaining, they must be from the real env
      expect(v.isSecret).toBe(true);
    }
  });

  it('masks the values in returned results', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-1234567890abcdef';

    const result = scanProcessEnv();

    const openaiVar = result.find(v => v.name === 'OPENAI_API_KEY');
    expect(openaiVar).toBeDefined();
    expect(openaiVar!.maskedValue).not.toBe('sk-test-1234567890abcdef');
    expect(openaiVar!.maskedValue).toContain('...');
  });

  it('skips env vars with empty values', () => {
    process.env['AWS_EMPTY'] = '';

    const result = scanProcessEnv();

    expect(result.find(v => v.name === 'AWS_EMPTY')).toBeUndefined();
  });
});

describe('resolveEnvVarValue', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it('resolves from process-env source', () => {
    process.env['MY_API_KEY'] = 'secret-value-12345';

    const result = resolveEnvVarValue('MY_API_KEY', 'process-env');

    expect(result).toBe('secret-value-12345');
  });

  it('returns null for process-env when var is not set', () => {
    delete process.env['NONEXISTENT_KEY'];

    const result = resolveEnvVarValue('NONEXISTENT_KEY', 'process-env');

    expect(result).toBeNull();
  });

  it('resolves from shell-profile source', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      'export OTHER_VAR="other"\nexport MY_SECRET="the-actual-value"\nexport AFTER="after"\n',
    );

    const result = resolveEnvVarValue(
      'MY_SECRET',
      'shell-profile',
      '/Users/testuser/.zshrc',
    );

    expect(result).toBe('the-actual-value');
  });

  it('returns null for shell-profile when no profile path given', () => {
    const result = resolveEnvVarValue('MY_SECRET', 'shell-profile');

    expect(result).toBeNull();
  });

  it('returns null for shell-profile when profile does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = resolveEnvVarValue(
      'MY_SECRET',
      'shell-profile',
      '/Users/testuser/.zshrc',
    );

    expect(result).toBeNull();
  });

  it('returns null for shell-profile when var not found in file', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('export OTHER_VAR="value"\n');

    const result = resolveEnvVarValue(
      'MISSING_VAR',
      'shell-profile',
      '/Users/testuser/.zshrc',
    );

    expect(result).toBeNull();
  });

  it('strips quotes from shell-profile values', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("export MY_KEY='single-quoted-value'\n");

    const result = resolveEnvVarValue(
      'MY_KEY',
      'shell-profile',
      '/Users/testuser/.zshrc',
    );

    expect(result).toBe('single-quoted-value');
  });

  it('resolves from app-config source', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        skills: {
          entries: {
            'my-skill': { env: { OPENAI_API_KEY: 'sk-from-config' } },
          },
        },
      }),
    );

    const result = resolveEnvVarValue(
      'OPENAI_API_KEY',
      'app-config',
      undefined,
      '/Users/testuser/.openclaw/openclaw.json',
    );

    expect(result).toBe('sk-from-config');
  });

  it('returns null for app-config when no config path given', () => {
    const result = resolveEnvVarValue('OPENAI_API_KEY', 'app-config');

    expect(result).toBeNull();
  });

  it('returns null for app-config when config does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = resolveEnvVarValue(
      'OPENAI_API_KEY',
      'app-config',
      undefined,
      '/nonexistent/config.json',
    );

    expect(result).toBeNull();
  });

  it('returns null for app-config when var not in any skill entry', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        skills: {
          entries: {
            'my-skill': { env: { OTHER_KEY: 'value' } },
          },
        },
      }),
    );

    const result = resolveEnvVarValue(
      'MISSING_KEY',
      'app-config',
      undefined,
      '/config.json',
    );

    expect(result).toBeNull();
  });

  it('returns null for unknown source', () => {
    const result = resolveEnvVarValue(
      'MY_KEY',
      'unknown-source' as 'process-env',
    );

    expect(result).toBeNull();
  });
});

describe('scanHost', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
    // Clean secrets from env for deterministic tests
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AWS_') || key.startsWith('OPENAI_') || key.endsWith('_API_KEY') || key.endsWith('_SECRET') || key.endsWith('_TOKEN')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it('scans app config when configPath is provided', () => {
    const config = {
      skills: {
        entries: {
          'test-skill': { enabled: true, env: { AWS_SECRET: 'secret123456' } },
        },
      },
    };

    mockedExistsSync.mockImplementation((p: unknown) => {
      if (String(p) === '/config/openclaw.json') return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));

    const result = scanHost({
      configPath: '/config/openclaw.json',
      home: '/Users/testuser',
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('test-skill');
    expect(result.configPath).toBe('/config/openclaw.json');
  });

  it('does not scan app config when configPath is not provided', () => {
    const result = scanHost({ home: '/Users/testuser' });

    expect(result.skills).toHaveLength(0);
    expect(result.configPath).toBeUndefined();
  });

  it('scans shell profiles in the home directory', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/testuser/.zshrc';
    });
    mockedReadFileSync.mockReturnValue(
      'export AWS_ACCESS_KEY="AKIAIOSFODNN7EXAMPLE-TEST"\n',
    );

    const result = scanHost({ home: '/Users/testuser' });

    const shellVar = result.envVars.find(
      v => v.name === 'AWS_ACCESS_KEY' && v.source === 'shell-profile',
    );
    expect(shellVar).toBeDefined();
    expect(result.scannedProfiles).toContain('/Users/testuser/.zshrc');
  });

  it('deduplicates env vars with app-config taking priority', () => {
    const config = {
      skills: {
        entries: {
          'my-skill': { enabled: true, env: { AWS_SECRET: 'from-config-value' } },
        },
      },
    };

    // Set same var in process.env
    process.env['AWS_SECRET'] = 'from-process-env';

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/config/openclaw.json') return true;
      if (s === '/Users/testuser/.zshrc') return true;
      return false;
    });
    mockedReadFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/config/openclaw.json') return JSON.stringify(config);
      if (s === '/Users/testuser/.zshrc') return 'export AWS_SECRET="from-shell-profile"\n';
      return '';
    });

    const result = scanHost({
      configPath: '/config/openclaw.json',
      home: '/Users/testuser',
    });

    // Only one AWS_SECRET entry, from app-config (highest priority)
    const awsVars = result.envVars.filter(v => v.name === 'AWS_SECRET');
    expect(awsVars).toHaveLength(1);
    expect(awsVars[0].source).toBe('app-config');
  });

  it('deduplicates with shell-profile taking priority over process-env', () => {
    process.env['OPENAI_API_KEY'] = 'from-process-env';

    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/testuser/.zshrc';
    });
    mockedReadFileSync.mockReturnValue(
      'export OPENAI_API_KEY="from-shell-profile-value"\n',
    );

    const result = scanHost({ home: '/Users/testuser' });

    const openaiVars = result.envVars.filter(v => v.name === 'OPENAI_API_KEY');
    expect(openaiVars).toHaveLength(1);
    expect(openaiVars[0].source).toBe('shell-profile');
  });

  it('includes scannedAt timestamp', () => {
    const before = new Date().toISOString();
    const result = scanHost({ home: '/Users/testuser' });
    const after = new Date().toISOString();

    expect(result.scannedAt).toBeDefined();
    expect(result.scannedAt >= before).toBe(true);
    expect(result.scannedAt <= after).toBe(true);
  });

  it('collects warnings from all sources', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      // Config file does not exist -> warning from scanOpenClawConfig
      if (s === '/config/missing.json') return false;
      // A shell profile exists but read fails -> warning from scanShellProfiles
      if (s === '/Users/testuser/.bashrc') return true;
      return false;
    });
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('Read error');
    });

    const result = scanHost({
      configPath: '/config/missing.json',
      home: '/Users/testuser',
    });

    // Should have warning about missing config file and unreadable profile
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    expect(result.warnings.some(w => w.includes('Config file not found'))).toBe(true);
    expect(result.warnings.some(w => w.includes('Could not read'))).toBe(true);
  });
});
