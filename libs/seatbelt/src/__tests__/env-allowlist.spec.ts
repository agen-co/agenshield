import { filterEnvByAllowlist, BASE_ENV_ALLOWLIST } from '../env-allowlist';

describe('filterEnvByAllowlist', () => {
  it('allows base allowlist variables', () => {
    const env = { HOME: '/home/user', PATH: '/usr/bin', SECRET_KEY: 'abc' };
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('HOME', '/home/user');
    expect(result).toHaveProperty('PATH', '/usr/bin');
    expect(result).not.toHaveProperty('SECRET_KEY');
  });

  it('supports prefix patterns (e.g. LC_*)', () => {
    const env = { LC_ALL: 'en_US.UTF-8', LC_CTYPE: 'UTF-8', LANG: 'en_US' };
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('LC_ALL');
    expect(result).toHaveProperty('LC_CTYPE');
    expect(result).toHaveProperty('LANG');
  });

  it('allows AGENSHIELD_* prefix', () => {
    const env = {
      AGENSHIELD_TRACE_ID: 'abc-123',
      AGENSHIELD_DEPTH: '2',
      AGENSHIELD_EXEC_ID: 'def-456',
    };
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('AGENSHIELD_TRACE_ID', 'abc-123');
    expect(result).toHaveProperty('AGENSHIELD_DEPTH', '2');
    expect(result).toHaveProperty('AGENSHIELD_EXEC_ID', 'def-456');
  });

  it('supports per-policy extensions', () => {
    const env = { HOME: '/home', CUSTOM_VAR: 'value', CUSTOM_OTHER: 'val2' };
    const result = filterEnvByAllowlist(env, ['CUSTOM_*']);
    expect(result).toHaveProperty('HOME');
    expect(result).toHaveProperty('CUSTOM_VAR');
    expect(result).toHaveProperty('CUSTOM_OTHER');
  });

  it('skips undefined values', () => {
    const env = { HOME: '/home', MISSING: undefined } as Record<string, string | undefined>;
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('HOME');
    expect(result).not.toHaveProperty('MISSING');
  });

  it('returns only allowed vars from a mixed environment', () => {
    const env = {
      HOME: '/home/user',
      PATH: '/usr/bin',
      AWS_SECRET_KEY: 'secret',
      DATABASE_URL: 'postgres://...',
      TERM: 'xterm-256color',
    };
    const result = filterEnvByAllowlist(env);
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['HOME', 'PATH', 'TERM']));
    expect(result).not.toHaveProperty('AWS_SECRET_KEY');
    expect(result).not.toHaveProperty('DATABASE_URL');
  });
});

describe('filterEnvByAllowlist — edge cases', () => {
  it('empty environment returns empty object', () => {
    const result = filterEnvByAllowlist({});
    expect(result).toEqual({});
  });

  it('explicit empty policyAllow array', () => {
    const env = { HOME: '/home/user', SECRET: 'bad' };
    const result = filterEnvByAllowlist(env, []);
    expect(result).toHaveProperty('HOME');
    expect(result).not.toHaveProperty('SECRET');
  });

  it('SSH_AUTH_SOCK allowed, SSH_ASKPASS stripped', () => {
    const env = {
      SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
      SSH_ASKPASS: '/usr/lib/ssh/ssh-askpass',
      SSH_CONNECTION: '192.168.1.1 22',
    };
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('SSH_AUTH_SOCK');
    expect(result).not.toHaveProperty('SSH_ASKPASS');
    expect(result).not.toHaveProperty('SSH_CONNECTION');
  });

  it('NODE_OPTIONS allowed through base list', () => {
    const env = { NODE_OPTIONS: '--max-old-space-size=4096' };
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('NODE_OPTIONS', '--max-old-space-size=4096');
  });

  it('toolchain vars: NVM_DIR, HOMEBREW_PREFIX, HOMEBREW_CELLAR, HOMEBREW_REPOSITORY', () => {
    const env = {
      NVM_DIR: '/home/user/.nvm',
      HOMEBREW_PREFIX: '/opt/homebrew',
      HOMEBREW_CELLAR: '/opt/homebrew/Cellar',
      HOMEBREW_REPOSITORY: '/opt/homebrew',
    };
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('NVM_DIR');
    expect(result).toHaveProperty('HOMEBREW_PREFIX');
    expect(result).toHaveProperty('HOMEBREW_CELLAR');
    expect(result).toHaveProperty('HOMEBREW_REPOSITORY');
  });

  it('macOS system vars: XPC_FLAGS, XPC_SERVICE_NAME, __CF_USER_TEXT_ENCODING', () => {
    const env = {
      XPC_FLAGS: '0x0',
      XPC_SERVICE_NAME: '0',
      __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x0',
    };
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('XPC_FLAGS');
    expect(result).toHaveProperty('XPC_SERVICE_NAME');
    expect(result).toHaveProperty('__CF_USER_TEXT_ENCODING');
  });

  it('SHLVL allowed', () => {
    const env = { SHLVL: '2' };
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('SHLVL', '2');
  });

  it('TMPDIR allowed', () => {
    const env = { TMPDIR: '/var/folders/xx/tmp' };
    const result = filterEnvByAllowlist(env);
    expect(result).toHaveProperty('TMPDIR', '/var/folders/xx/tmp');
  });

  it('multiple prefix patterns from policy', () => {
    const env = {
      CUSTOM_A: '1',
      CUSTOM_B: '2',
      MY_APP_X: '3',
      MY_APP_Y: '4',
      UNRELATED: '5',
    };
    const result = filterEnvByAllowlist(env, ['CUSTOM_*', 'MY_APP_*']);
    expect(result).toHaveProperty('CUSTOM_A');
    expect(result).toHaveProperty('CUSTOM_B');
    expect(result).toHaveProperty('MY_APP_X');
    expect(result).toHaveProperty('MY_APP_Y');
    expect(result).not.toHaveProperty('UNRELATED');
  });

  it('exact match in policyAllow (not prefix)', () => {
    const env = {
      SPECIAL_VAR: 'value',
      SPECIAL_VAR_EXTRA: 'should-not-match',
    };
    const result = filterEnvByAllowlist(env, ['SPECIAL_VAR']);
    expect(result).toHaveProperty('SPECIAL_VAR');
    expect(result).not.toHaveProperty('SPECIAL_VAR_EXTRA');
  });

  it('exact match variables NOT in allowlist are stripped', () => {
    const env = {
      AWS_SECRET_ACCESS_KEY: 'secret',
      GITHUB_TOKEN: 'ghp_abc',
      DATABASE_URL: 'postgres://...',
      NPM_TOKEN: 'npm_xyz',
    };
    const result = filterEnvByAllowlist(env);
    expect(result).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(result).not.toHaveProperty('GITHUB_TOKEN');
    expect(result).not.toHaveProperty('DATABASE_URL');
    expect(result).not.toHaveProperty('NPM_TOKEN');
  });
});

describe('BASE_ENV_ALLOWLIST', () => {
  it('includes essential variables', () => {
    expect(BASE_ENV_ALLOWLIST).toContain('HOME');
    expect(BASE_ENV_ALLOWLIST).toContain('PATH');
    expect(BASE_ENV_ALLOWLIST).toContain('TERM');
  });

  it('includes AGENSHIELD_* prefix pattern', () => {
    expect(BASE_ENV_ALLOWLIST).toContain('AGENSHIELD_*');
  });

  it('includes LC_* prefix pattern', () => {
    expect(BASE_ENV_ALLOWLIST).toContain('LC_*');
  });

  it('includes NODE_OPTIONS', () => {
    expect(BASE_ENV_ALLOWLIST).toContain('NODE_OPTIONS');
  });

  it('includes SSH_AUTH_SOCK', () => {
    expect(BASE_ENV_ALLOWLIST).toContain('SSH_AUTH_SOCK');
  });
});
