jest.mock('node:child_process', () => ({
  execSync: jest.fn().mockReturnValue(''),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  accessSync: jest.fn(() => { throw new Error('not found'); }),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
}));

jest.mock('node:os', () => ({
  userInfo: jest.fn().mockReturnValue({ username: 'testuser' }),
  homedir: jest.fn().mockReturnValue('/Users/testuser'),
}));

jest.mock('../../legacy', () => ({
  userExistsSync: jest.fn().mockReturnValue(false),
  GUARDED_SHELL_PATH: '/usr/local/bin/guarded-shell',
}));

import { isSecretEnvVar, checkSecurityStatus } from '../../detection/security';

describe('isSecretEnvVar', () => {
  it('returns true for AWS_ prefix', () => {
    expect(isSecretEnvVar('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(isSecretEnvVar('AWS_ACCESS_KEY_ID')).toBe(true);
  });

  it('returns true for OPENAI_ prefix', () => {
    expect(isSecretEnvVar('OPENAI_API_KEY')).toBe(true);
  });

  it('returns true for ANTHROPIC_ prefix', () => {
    expect(isSecretEnvVar('ANTHROPIC_API_KEY')).toBe(true);
  });

  it('returns true for STRIPE_ prefix', () => {
    expect(isSecretEnvVar('STRIPE_SECRET_KEY')).toBe(true);
  });

  it('returns true for _API_KEY suffix', () => {
    expect(isSecretEnvVar('MY_CUSTOM_API_KEY')).toBe(true);
  });

  it('returns true for _SECRET suffix', () => {
    expect(isSecretEnvVar('CLIENT_SECRET')).toBe(true);
  });

  it('returns true for _TOKEN suffix', () => {
    expect(isSecretEnvVar('NPM_TOKEN')).toBe(true);
    expect(isSecretEnvVar('GITHUB_TOKEN')).toBe(true);
  });

  it('returns true for _PASSWORD suffix', () => {
    expect(isSecretEnvVar('DB_PASSWORD')).toBe(true);
  });

  it('returns false for HOME', () => {
    expect(isSecretEnvVar('HOME')).toBe(false);
  });

  it('returns false for PATH', () => {
    expect(isSecretEnvVar('PATH')).toBe(false);
  });

  it('returns false for NODE_ENV', () => {
    expect(isSecretEnvVar('NODE_ENV')).toBe(false);
  });

  it('returns false for SHELL', () => {
    expect(isSecretEnvVar('SHELL')).toBe(false);
  });

  it('returns false for USER', () => {
    expect(isSecretEnvVar('USER')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSecretEnvVar('aws_secret_key')).toBe(true);
    expect(isSecretEnvVar('Openai_Api_Key')).toBe(true);
  });
});

describe('checkSecurityStatus', () => {
  it('returns SecurityStatus shape', () => {
    const status = checkSecurityStatus();

    expect(status).toHaveProperty('runningAsRoot');
    expect(status).toHaveProperty('currentUser');
    expect(status).toHaveProperty('sandboxUserExists');
    expect(status).toHaveProperty('isIsolated');
    expect(status).toHaveProperty('guardedShellInstalled');
    expect(status).toHaveProperty('exposedSecrets');
    expect(status).toHaveProperty('warnings');
    expect(status).toHaveProperty('critical');
    expect(status).toHaveProperty('recommendations');
    expect(status).toHaveProperty('level');
  });

  it('detects exposed secrets in provided env', () => {
    const status = checkSecurityStatus({
      env: {
        AWS_SECRET_KEY: 'sk-test',
        HOME: '/Users/test',
        OPENAI_API_KEY: 'sk-openai',
      },
    });

    expect(status.exposedSecrets).toContain('AWS_SECRET_KEY');
    expect(status.exposedSecrets).toContain('OPENAI_API_KEY');
    expect(status.exposedSecrets).not.toContain('HOME');
  });

  it('returns unprotected level when no sandbox user exists', () => {
    const status = checkSecurityStatus({
      env: {},
    });

    expect(status.sandboxUserExists).toBe(false);
    expect(['unprotected', 'partial', 'critical']).toContain(status.level);
  });

  it('level is one of the defined values', () => {
    const status = checkSecurityStatus({ env: {} });

    expect(['secure', 'partial', 'unprotected', 'critical']).toContain(
      status.level,
    );
  });

  it('includes recommendations when sandbox user is missing', () => {
    const status = checkSecurityStatus({ env: {} });

    expect(status.recommendations.length).toBeGreaterThan(0);
  });
});
