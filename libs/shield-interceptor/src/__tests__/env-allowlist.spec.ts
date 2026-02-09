import { filterEnvByAllowlist, BASE_ENV_ALLOWLIST } from '../seatbelt/env-allowlist';

describe('filterEnvByAllowlist', () => {
  const fakeEnv: Record<string, string> = {
    HOME: '/Users/agent',
    USER: 'agent',
    LOGNAME: 'agent',
    PATH: '/usr/bin:/bin',
    SHELL: '/bin/zsh',
    TMPDIR: '/var/folders/xx/T/',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'C',
    LC_CTYPE: 'UTF-8',
    SHLVL: '1',
    NVM_DIR: '/Users/agent/.nvm',
    HOMEBREW_PREFIX: '/opt/homebrew',
    HOMEBREW_CELLAR: '/opt/homebrew/Cellar',
    HOMEBREW_REPOSITORY: '/opt/homebrew',
    XPC_FLAGS: '0x0',
    XPC_SERVICE_NAME: '0',
    __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x0',
    SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
    AGENSHIELD_SOCKET: '/var/run/agenshield/agenshield.sock',
    AGENSHIELD_HOST: 'localhost',
    AGENSHIELD_EXEC_ID: 'abc-123',
    // Dangerous vars that must be stripped
    DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
    DYLD_LIBRARY_PATH: '/tmp/evil',
    DYLD_FALLBACK_LIBRARY_PATH: '/tmp/evil',
    LD_PRELOAD: '/tmp/evil.so',
    PYTHONPATH: '/tmp/evil',
    NODE_PATH: '/tmp/evil',
    RUBYLIB: '/tmp/evil',
    PERL5LIB: '/tmp/evil',
    SSH_ASKPASS: '/tmp/evil',
    NODE_OPTIONS: '--require /tmp/evil.js',
    // Secrets that must be stripped
    SECRET_API_KEY: 'sk-1234',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI',
    AWS_SESSION_TOKEN: 'FwoGZX',
    GITHUB_TOKEN: 'ghp_xxxx',
    OPENAI_API_KEY: 'sk-openai',
    ANTHROPIC_API_KEY: 'sk-ant',
  };

  it('allows base allowlist exact matches through', () => {
    const result = filterEnvByAllowlist(fakeEnv);
    expect(result['HOME']).toBe('/Users/agent');
    expect(result['USER']).toBe('agent');
    expect(result['LOGNAME']).toBe('agent');
    expect(result['PATH']).toBe('/usr/bin:/bin');
    expect(result['SHELL']).toBe('/bin/zsh');
    expect(result['TMPDIR']).toBe('/var/folders/xx/T/');
    expect(result['TERM']).toBe('xterm-256color');
    expect(result['COLORTERM']).toBe('truecolor');
    expect(result['LANG']).toBe('en_US.UTF-8');
    expect(result['SHLVL']).toBe('1');
    expect(result['NVM_DIR']).toBe('/Users/agent/.nvm');
    expect(result['HOMEBREW_PREFIX']).toBe('/opt/homebrew');
    expect(result['HOMEBREW_CELLAR']).toBe('/opt/homebrew/Cellar');
    expect(result['HOMEBREW_REPOSITORY']).toBe('/opt/homebrew');
    expect(result['XPC_FLAGS']).toBe('0x0');
    expect(result['XPC_SERVICE_NAME']).toBe('0');
    expect(result['__CF_USER_TEXT_ENCODING']).toBe('0x1F5:0x0:0x0');
    expect(result['SSH_AUTH_SOCK']).toBe('/tmp/ssh-agent.sock');
  });

  it('allows LC_* prefix pattern matches through', () => {
    const result = filterEnvByAllowlist(fakeEnv);
    expect(result['LC_ALL']).toBe('C');
    expect(result['LC_CTYPE']).toBe('UTF-8');
  });

  it('allows AGENSHIELD_* prefix pattern matches through', () => {
    const result = filterEnvByAllowlist(fakeEnv);
    expect(result['AGENSHIELD_SOCKET']).toBe('/var/run/agenshield/agenshield.sock');
    expect(result['AGENSHIELD_HOST']).toBe('localhost');
    expect(result['AGENSHIELD_EXEC_ID']).toBe('abc-123');
  });

  it('strips dangerous DYLD/LD injection variables', () => {
    const result = filterEnvByAllowlist(fakeEnv);
    expect(result['DYLD_INSERT_LIBRARIES']).toBeUndefined();
    expect(result['DYLD_LIBRARY_PATH']).toBeUndefined();
    expect(result['DYLD_FALLBACK_LIBRARY_PATH']).toBeUndefined();
    expect(result['LD_PRELOAD']).toBeUndefined();
  });

  it('strips path injection variables', () => {
    const result = filterEnvByAllowlist(fakeEnv);
    expect(result['PYTHONPATH']).toBeUndefined();
    expect(result['NODE_PATH']).toBeUndefined();
    expect(result['RUBYLIB']).toBeUndefined();
    expect(result['PERL5LIB']).toBeUndefined();
  });

  it('strips NODE_OPTIONS', () => {
    const result = filterEnvByAllowlist(fakeEnv);
    expect(result['NODE_OPTIONS']).toBeUndefined();
  });

  it('strips SSH_ASKPASS but allows SSH_AUTH_SOCK', () => {
    const result = filterEnvByAllowlist(fakeEnv);
    expect(result['SSH_ASKPASS']).toBeUndefined();
    expect(result['SSH_AUTH_SOCK']).toBe('/tmp/ssh-agent.sock');
  });

  it('strips sensitive credentials and secrets', () => {
    const result = filterEnvByAllowlist(fakeEnv);
    expect(result['SECRET_API_KEY']).toBeUndefined();
    expect(result['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(result['AWS_SESSION_TOKEN']).toBeUndefined();
    expect(result['GITHUB_TOKEN']).toBeUndefined();
    expect(result['OPENAI_API_KEY']).toBeUndefined();
    expect(result['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('applies per-policy envAllow extensions', () => {
    const result = filterEnvByAllowlist(fakeEnv, ['SECRET_API_KEY', 'AWS_*']);
    expect(result['SECRET_API_KEY']).toBe('sk-1234');
    expect(result['AWS_SECRET_ACCESS_KEY']).toBe('wJalrXUtnFEMI');
    expect(result['AWS_SESSION_TOKEN']).toBe('FwoGZX');
    // Others should still be stripped
    expect(result['GITHUB_TOKEN']).toBeUndefined();
    expect(result['OPENAI_API_KEY']).toBeUndefined();
  });

  it('returns empty object for empty source env', () => {
    const result = filterEnvByAllowlist({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('skips undefined values in source env', () => {
    const envWithUndef = { HOME: '/Users/agent', UNDEF: undefined as unknown as string };
    const result = filterEnvByAllowlist(envWithUndef);
    expect(result['HOME']).toBe('/Users/agent');
    expect('UNDEF' in result).toBe(false);
  });

  it('BASE_ENV_ALLOWLIST is a non-empty readonly array', () => {
    expect(Array.isArray(BASE_ENV_ALLOWLIST)).toBe(true);
    expect(BASE_ENV_ALLOWLIST.length).toBeGreaterThan(10);
  });

  it('per-policy envAllow with prefix pattern does not affect base entries', () => {
    // Adding a policy pattern should not interfere with base allowlist
    const result = filterEnvByAllowlist(fakeEnv, ['CUSTOM_VAR']);
    expect(result['HOME']).toBe('/Users/agent');
    expect(result['CUSTOM_VAR']).toBeUndefined(); // not in source env
  });
});
