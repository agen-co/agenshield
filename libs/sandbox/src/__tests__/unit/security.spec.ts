jest.mock('node:child_process', () => ({
  exec: jest.fn((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
    cb(null, '', '');
  }),
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
  it('returns SecurityStatus shape', async () => {
    const status = await checkSecurityStatus();

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

  it('detects exposed secrets in provided env', async () => {
    const status = await checkSecurityStatus({
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

  it('returns unprotected level when no sandbox user exists', async () => {
    const status = await checkSecurityStatus({
      env: {},
    });

    expect(status.sandboxUserExists).toBe(false);
    expect(['unprotected', 'partial', 'critical']).toContain(status.level);
  });

  it('level is one of the defined values', async () => {
    const status = await checkSecurityStatus({ env: {} });

    expect(['secure', 'partial', 'unprotected', 'critical']).toContain(
      status.level,
    );
  });

  it('includes recommendations when sandbox user is missing and targets are configured', async () => {
    const status = await checkSecurityStatus({
      env: {},
      knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
    });

    expect(status.recommendations.length).toBeGreaterThan(0);
  });

  it('suppresses sandbox user warning when no targets are configured', async () => {
    const status = await checkSecurityStatus({ env: {} });

    expect(status.warnings).not.toEqual(
      expect.arrayContaining([expect.stringContaining('No sandbox user found')]),
    );
  });

  describe('agenshield management command filtering', () => {
    const { exec } = require('node:child_process') as { exec: jest.Mock };
    const { userExistsSync } = require('../../legacy') as { userExistsSync: jest.Mock };

    // Helper to build a ps aux line with correct column count (11+ fields)
    // USER PID %CPU %MEM VSZ RSS TT STAT STARTED TIME COMMAND...
    function psLine(user: string, pid: number, command: string): string {
      return `${user} ${pid} 0.0 0.1 1000 500 ?? Ss 10:00AM 0:00.01 ${command}`;
    }

    function mockPsOutput(lines: string[]) {
      exec.mockImplementation((cmd: string, _opts: unknown, cb: (err: null, res: { stdout: string }) => void) => {
        if (cmd.startsWith('ps aux')) {
          cb(null, { stdout: lines.join('\n') } as never);
        } else if (cmd.includes('dscl')) {
          cb(null, { stdout: '' } as never);
        } else {
          cb(null, { stdout: '' } as never);
        }
      });
    }

    afterEach(() => {
      exec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, '', '');
      });
      userExistsSync.mockReturnValue(false);
    });

    it('excludes launchctl commands managing com.agenshield.* services', async () => {
      userExistsSync.mockReturnValue(true);
      mockPsOutput([
        psLine('root', 100, 'launchctl kickstart -k system/com.agenshield.broker.openclaw'),
        psLine('root', 101, '/bin/bash -c launchctl kickstart -k system/com.agenshield.broker.openclaw 2>/dev/null; true'),
      ]);

      const status = await checkSecurityStatus({
        env: {},
        knownSandboxUsers: ['ash_default_agent'],
        knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
      });

      expect(status.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('launchctl')]),
      );
    });

    it('excludes lifecycle delegation via sudo -u <hostUser>', async () => {
      userExistsSync.mockReturnValue(true);
      mockPsOutput([
        psLine('root', 200, 'sudo -H -u testuser openclaw gateway stop --force'),
        psLine('root', 201, '/bin/bash -c sudo -H -u testuser openclaw gateway stop 2>/dev/null; pkill -u testuser openclaw'),
      ]);

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
      });

      expect(status.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('gateway stop')]),
      );
    });

    it('excludes pkill cleanup commands targeting process patterns', async () => {
      userExistsSync.mockReturnValue(true);
      mockPsOutput([
        psLine('root', 300, 'pkill -u testuser openclaw'),
      ]);

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
      });

      expect(status.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('pkill')]),
      );
    });

    it('still flags launchctl commands with non-agenshield labels', async () => {
      userExistsSync.mockReturnValue(true);
      mockPsOutput([
        psLine('root', 400, 'launchctl kickstart -k system/com.malicious.openclaw'),
      ]);

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
      });

      expect(status.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('launchctl')]),
      );
    });

    it('still flags unknown root processes running target patterns', async () => {
      userExistsSync.mockReturnValue(true);
      mockPsOutput([
        psLine('root', 500, 'openclaw gateway serve --port 8080'),
      ]);

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
      });

      expect(status.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('PID 500')]),
      );
    });

    it('still flags sudo delegation to unknown users', async () => {
      userExistsSync.mockReturnValue(true);
      mockPsOutput([
        psLine('root', 600, 'sudo -H -u attacker openclaw gateway stop'),
      ]);

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
      });

      expect(status.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('PID 600')]),
      );
    });
  });
});
