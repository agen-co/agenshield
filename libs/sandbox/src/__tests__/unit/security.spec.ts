// Use var to avoid TDZ issues with SWC/Jest hoisting
var mockGetuid: (() => number) | undefined = undefined;

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

import * as fs from 'node:fs';
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

  describe('knownSandboxUsers resolution', () => {
    const { exec } = require('node:child_process') as { exec: jest.Mock };
    const { userExistsSync } = require('../../legacy') as { userExistsSync: jest.Mock };

    afterEach(() => {
      exec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, '', '');
      });
      userExistsSync.mockReturnValue(false);
    });

    it('uses knownSandboxUsers when provided', async () => {
      userExistsSync.mockImplementation((u: string) => u === 'custom_user');

      const status = await checkSecurityStatus({
        env: {},
        knownSandboxUsers: ['custom_user'],
      });

      expect(status.sandboxUserExists).toBe(true);
    });

    it('discovers sandbox users from dscl when no known users provided', async () => {
      exec.mockImplementation((cmd: string, _opts: unknown, cb: (err: null, res: { stdout: string }) => void) => {
        if (cmd.includes('dscl')) {
          cb(null, { stdout: 'agentshield_test\nash_default_agent\nroot\n' } as never);
        } else {
          cb(null, { stdout: '' } as never);
        }
      });
      userExistsSync.mockImplementation((u: string) => u === 'agentshield_test');

      const status = await checkSecurityStatus({ env: {} });

      expect(status.sandboxUserExists).toBe(true);
    });

    it('falls back to legacy users when dscl returns no matches', async () => {
      exec.mockImplementation((cmd: string, _opts: unknown, cb: (err: null, res: { stdout: string }) => void) => {
        if (cmd.includes('dscl')) {
          cb(null, { stdout: 'root\nadmin\n' } as never);
        } else {
          cb(null, { stdout: '' } as never);
        }
      });
      userExistsSync.mockReturnValue(false);

      const status = await checkSecurityStatus({ env: {} });

      // Falls back to LEGACY_SANDBOX_USERS but none exist
      expect(status.sandboxUserExists).toBe(false);
    });
  });

  describe('guarded shell checks', () => {
    const { exec } = require('node:child_process') as { exec: jest.Mock };
    const { userExistsSync } = require('../../legacy') as { userExistsSync: jest.Mock };
    const mockedAccessSync = fs.accessSync as jest.MockedFunction<typeof fs.accessSync>;

    afterEach(() => {
      exec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, '', '');
      });
      userExistsSync.mockReturnValue(false);
      mockedAccessSync.mockImplementation(() => { throw new Error('not found'); });
    });

    it('reports guarded shell installed when legacy path is accessible', async () => {
      userExistsSync.mockReturnValue(true);
      mockedAccessSync.mockImplementation((p: unknown) => {
        if (String(p) === '/usr/local/bin/guarded-shell') return undefined;
        throw new Error('not found');
      });

      const status = await checkSecurityStatus({
        env: {},
        knownSandboxUsers: ['ash_default_agent'],
      });

      expect(status.guardedShellInstalled).toBe(true);
    });

    it('checks per-target guarded shell paths when targets have agentHomeDir', async () => {
      userExistsSync.mockReturnValue(true);
      mockedAccessSync.mockImplementation((p: unknown) => {
        const s = String(p);
        if (s === '/Users/ash_default_agent/.agenshield/bin/guarded-shell') return undefined;
        throw new Error('not found');
      });

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{
          targetName: 'openclaw',
          users: ['ash_default_agent'],
          processPatterns: ['openclaw'],
          agentHomeDir: '/Users/ash_default_agent',
        }],
      });

      expect(status.guardedShellInstalled).toBe(true);
    });

    it('warns when per-target guarded shell is missing', async () => {
      userExistsSync.mockReturnValue(true);
      mockedAccessSync.mockImplementation(() => { throw new Error('not found'); });

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{
          targetName: 'openclaw',
          users: ['ash_default_agent'],
          processPatterns: ['openclaw'],
          agentHomeDir: '/Users/ash_default_agent',
        }],
      });

      expect(status.guardedShellInstalled).toBe(false);
      expect(status.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Guarded shell not installed')]),
      );
      expect(status.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('openclaw')]),
      );
    });
  });

  describe('setup command filtering', () => {
    const { exec } = require('node:child_process') as { exec: jest.Mock };
    const { userExistsSync } = require('../../legacy') as { userExistsSync: jest.Mock };

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

    it('excludes setup commands targeting sandbox users (dscl, chown, etc.)', async () => {
      userExistsSync.mockReturnValue(true);
      mockPsOutput([
        psLine('root', 700, 'dscl . -create /Users/ash_default_agent UserShell /bin/bash'),
        psLine('root', 701, 'chown -R ash_default_agent /Users/ash_default_agent'),
      ]);

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
      });

      expect(status.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('PID 700')]),
      );
      expect(status.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('PID 701')]),
      );
    });

    it('excludes xargs kill cleanup commands targeting sandbox users', async () => {
      userExistsSync.mockReturnValue(true);
      mockPsOutput([
        psLine('root', 800, 'ps -u $(id -u ash_default_agent) -o pid= | xargs kill -9'),
      ]);

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
      });

      expect(status.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('PID 800')]),
      );
    });

    it('excludes bash-wrapped sudo delegation to sandbox users', async () => {
      userExistsSync.mockReturnValue(true);
      mockPsOutput([
        psLine('root', 900, '/bin/bash -c sudo -H -u ash_default_agent openclaw gateway start'),
      ]);

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [{ targetName: 'openclaw', users: ['ash_default_agent'], processPatterns: ['openclaw'] }],
      });

      expect(status.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('PID 900')]),
      );
    });
  });

  describe('cross-target process validation', () => {
    const { exec } = require('node:child_process') as { exec: jest.Mock };
    const { userExistsSync } = require('../../legacy') as { userExistsSync: jest.Mock };

    function psLine(user: string, pid: number, command: string): string {
      return `${user} ${pid} 0.0 0.1 1000 500 ?? Ss 10:00AM 0:00.01 ${command}`;
    }

    afterEach(() => {
      exec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, '', '');
      });
      userExistsSync.mockReturnValue(false);
    });

    it('detects cross-target process running under wrong sandbox user', async () => {
      userExistsSync.mockReturnValue(true);

      // The grep command uses bracketEscape: "openclaw" → "[o]penclaw"
      // So we match on "penclaw" (the unescaped part) rather than "openclaw"
      exec.mockImplementation((cmd: string, _opts: unknown, cb: (err: null, res: { stdout: string }) => void) => {
        if (cmd.includes('grep') && cmd.includes('penclaw') && !cmd.includes('lawbot')) {
          // This is the per-target grep for "openclaw" pattern group only
          cb(null, { stdout: psLine('ash_user_b', 1001, 'openclaw serve') } as never);
        } else if (cmd.includes('grep') && cmd.includes('lawbot') && !cmd.includes('penclaw')) {
          // Per-target grep for "clawbot" pattern group only
          cb(null, { stdout: '' } as never);
        } else if (cmd.includes('grep')) {
          // Combined initial grep for both patterns — return the process too
          cb(null, { stdout: psLine('ash_user_b', 1001, 'openclaw serve') } as never);
        } else if (cmd.includes('dscl')) {
          cb(null, { stdout: '' } as never);
        } else {
          cb(null, { stdout: '' } as never);
        }
      });

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [
          { targetName: 'openclaw', users: ['ash_user_a'], processPatterns: ['openclaw'] },
          { targetName: 'clawbot', users: ['ash_user_b'], processPatterns: ['clawbot'] },
        ],
      });

      expect(status.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Cross-target')]),
      );
      expect(status.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining('Restart affected targets')]),
      );
    });

    it('merges user sets for targets sharing the same process patterns', async () => {
      userExistsSync.mockReturnValue(true);

      exec.mockImplementation((cmd: string, _opts: unknown, cb: (err: null, res: { stdout: string }) => void) => {
        if (cmd.includes('grep') && cmd.includes('penclaw')) {
          // Process runs under ash_user_b, which is valid because both targets share patterns
          cb(null, { stdout: psLine('ash_user_b', 1002, 'openclaw serve') } as never);
        } else if (cmd.includes('dscl')) {
          cb(null, { stdout: '' } as never);
        } else {
          cb(null, { stdout: '' } as never);
        }
      });

      const status = await checkSecurityStatus({
        env: {},
        knownTargets: [
          { targetName: 'openclaw-1', users: ['ash_user_a'], processPatterns: ['openclaw'] },
          { targetName: 'openclaw-2', users: ['ash_user_b'], processPatterns: ['openclaw'] },
        ],
      });

      // Should NOT have cross-target warning because pattern groups are merged
      expect(status.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('Cross-target')]),
      );
    });
  });

  describe('security level determination', () => {
    const { exec } = require('node:child_process') as { exec: jest.Mock };
    const { userExistsSync } = require('../../legacy') as { userExistsSync: jest.Mock };

    afterEach(() => {
      exec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, '', '');
      });
      userExistsSync.mockReturnValue(false);
    });

    it('returns critical level when running as root (non-daemon)', async () => {
      userExistsSync.mockReturnValue(false);
      const origGetuid = process.getuid;
      process.getuid = () => 0;

      try {
        const status = await checkSecurityStatus({ env: {} });

        expect(status.critical).toEqual(
          expect.arrayContaining([expect.stringContaining('Running as root')]),
        );
        expect(status.level).toBe('critical');
      } finally {
        process.getuid = origGetuid;
      }
    });

    it('suppresses root warning when callerRole is daemon', async () => {
      userExistsSync.mockReturnValue(false);
      const origGetuid = process.getuid;
      process.getuid = () => 0;

      try {
        const status = await checkSecurityStatus({ env: {}, callerRole: 'daemon' });

        expect(status.critical).not.toEqual(
          expect.arrayContaining([expect.stringContaining('Running as root')]),
        );
      } finally {
        process.getuid = origGetuid;
      }
    });
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
