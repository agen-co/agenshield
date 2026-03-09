/**
 * Tests for sudo password verification
 */

import * as childProcess from 'node:child_process';
import { RateLimitError } from '../errors';

// Must be imported after mocking
jest.mock('node:child_process');

const mockedExecFile = childProcess.execFile as unknown as jest.Mock;
const mockedExecSync = childProcess.execSync as unknown as jest.Mock;

// Import after mock setup
import { verifySudoPassword, getCurrentUsername, resetRateLimit } from '../sudo-verify';

describe('Sudo verification', () => {
  beforeEach(() => {
    resetRateLimit();
    jest.clearAllMocks();
  });

  describe('verifySudoPassword', () => {
    it('should resolve valid for successful dscl', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
          cb(null);
        },
      );

      const result = await verifySudoPassword('user1', 'pass1');
      expect(result).toEqual({ valid: true, username: 'user1' });
      expect(mockedExecFile).toHaveBeenCalledWith(
        '/usr/bin/dscl',
        ['.', '-authonly', 'user1', 'pass1'],
        { timeout: 10000 },
        expect.any(Function),
      );
    });

    it('should resolve invalid for failed dscl', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
          cb(new Error('auth failed'));
        },
      );

      const result = await verifySudoPassword('user1', 'wrong');
      expect(result).toEqual({ valid: false, username: 'user1' });
    });

    it('should clear attempts on successful auth', async () => {
      // Fail 4 times (attempts array: 4 entries)
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
          cb(new Error('fail'));
        },
      );
      for (let i = 0; i < 4; i++) {
        await verifySudoPassword('user1', 'wrong');
      }

      // Succeed — should clear attempts
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
          cb(null);
        },
      );
      await verifySudoPassword('user1', 'right');

      // Should be able to make 5 more failed attempts without rate limit
      // (proves attempts were cleared by the success above)
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
          cb(new Error('fail'));
        },
      );
      for (let i = 0; i < 5; i++) {
        await verifySudoPassword('user1', 'wrong');
      }
      // 6th attempt after clear should now throw (5 recorded)
      await expect(verifySudoPassword('user1', 'wrong')).rejects.toThrow(RateLimitError);
    });

    it('should throw RateLimitError after 5 attempts', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
          cb(new Error('fail'));
        },
      );

      for (let i = 0; i < 5; i++) {
        await verifySudoPassword('user1', 'wrong');
      }

      await expect(verifySudoPassword('user1', 'wrong')).rejects.toThrow(RateLimitError);
    });
  });

  describe('getCurrentUsername', () => {
    const origEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...origEnv };
    });

    it('should return SUDO_USER if set', () => {
      process.env.SUDO_USER = 'sudoguy';
      expect(getCurrentUsername()).toBe('sudoguy');
    });

    it('should use stat command on darwin when no SUDO_USER', () => {
      delete process.env.SUDO_USER;
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedExecSync.mockReturnValue('consoleuser\n');
      expect(getCurrentUsername()).toBe('consoleuser');

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    it('should skip root console user on darwin', () => {
      delete process.env.SUDO_USER;
      process.env.USER = 'fallbackuser';
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedExecSync.mockReturnValue('root\n');
      expect(getCurrentUsername()).toBe('fallbackuser');

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    it('should fall back to USER env on execSync failure', () => {
      delete process.env.SUDO_USER;
      process.env.USER = 'envuser';
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedExecSync.mockImplementation(() => {
        throw new Error('command failed');
      });
      expect(getCurrentUsername()).toBe('envuser');

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    it('should return unknown when no env vars and not darwin', () => {
      delete process.env.SUDO_USER;
      delete process.env.USER;
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      expect(getCurrentUsername()).toBe('unknown');

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });
  });

  describe('checkRateLimit (expired attempts)', () => {
    it('should prune attempts outside the rate limit window', async () => {
      // Manually push old timestamps that are outside the 15-minute window
      const now = Date.now();
      const sudoModule = require('../sudo-verify');

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
          cb(new Error('fail'));
        },
      );

      // Fill 5 attempts
      for (let i = 0; i < 5; i++) {
        await verifySudoPassword('user1', 'wrong');
      }

      // Now we're rate limited
      await expect(verifySudoPassword('user1', 'wrong')).rejects.toThrow(RateLimitError);

      // Reset and simulate old expired attempts by using jest timer tricks
      resetRateLimit();

      // Make 5 attempts with mocked old Date.now
      const originalDateNow = Date.now;
      const oldTime = now - 16 * 60 * 1000; // 16 minutes ago
      Date.now = jest.fn().mockReturnValue(oldTime);

      for (let i = 0; i < 5; i++) {
        await verifySudoPassword('user1', 'wrong');
      }

      // Restore real time — old attempts should be pruned
      Date.now = originalDateNow;

      // Should NOT throw because old attempts are outside the window
      const result = await verifySudoPassword('user1', 'wrong');
      expect(result.valid).toBe(false);
    });
  });

  describe('resetRateLimit', () => {
    it('should allow attempts after reset', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
          cb(new Error('fail'));
        },
      );

      for (let i = 0; i < 5; i++) {
        await verifySudoPassword('user1', 'wrong');
      }

      resetRateLimit();

      // Should not throw after reset
      const result = await verifySudoPassword('user1', 'wrong');
      expect(result.valid).toBe(false);
    });
  });
});
