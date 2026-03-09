/**
 * Shield Client CLI tests
 *
 * Uses jest.isolateModules to handle the auto-running main() at module level.
 */

// Mock BrokerClient before any imports
const mockPing = jest.fn();
const mockHttpRequest = jest.fn();
const mockFileRead = jest.fn();
const mockFileWrite = jest.fn();
const mockFileList = jest.fn();
const mockExec = jest.fn();
const mockOpenUrl = jest.fn();
const mockSecretInject = jest.fn();
const mockPolicyCheck = jest.fn();

jest.mock('../../client/broker-client.js', () => ({
  BrokerClient: jest.fn().mockImplementation(() => ({
    ping: mockPing,
    httpRequest: mockHttpRequest,
    fileRead: mockFileRead,
    fileWrite: mockFileWrite,
    fileList: mockFileList,
    exec: mockExec,
    openUrl: mockOpenUrl,
    secretInject: mockSecretInject,
    policyCheck: mockPolicyCheck,
  })),
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
}));

import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { EventEmitter } from 'node:events';

// Helper to load the shield-client module in isolation with given argv
async function runCli(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const originalArgv = process.argv;
  const originalExit = process.exit;

  let exitCode: number | null = null;
  let stdout = '';
  let stderr = '';

  const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation((...msgArgs) => {
    stdout += msgArgs.join(' ') + '\n';
  });
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...msgArgs) => {
    stderr += msgArgs.join(' ') + '\n';
  });

  process.argv = ['node', 'shield-client', ...args];
  // First call throws to halt execution in main(); subsequent calls
  // (from the module-level .catch() re-invoking process.exit) are silent.
  process.exit = ((code: number) => {
    if (exitCode === null) {
      exitCode = code;
      throw new Error(`__EXIT_${code}__`);
    }
    // Second+ call: just record if different, don't throw again
  }) as any;

  try {
    await jest.isolateModulesAsync(async () => {
      try {
        await import('../../client/shield-client.js');
        // main() is called at module load — give it time to settle
        await new Promise((r) => setTimeout(r, 100));
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith('__EXIT_')) {
          throw e;
        }
      }
    });
  } finally {
    process.argv = originalArgv;
    process.exit = originalExit;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  }

  return { exitCode, stdout, stderr };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('shield-client CLI', () => {
  describe('main() dispatch', () => {
    it('shows help with no args', async () => {
      const { stdout } = await runCli([]);
      expect(stdout).toContain('Usage: shield-client');
    });

    it('shows help for --help', async () => {
      const { stdout } = await runCli(['--help']);
      expect(stdout).toContain('Usage: shield-client');
    });

    it('exits 1 for unknown command', async () => {
      const { exitCode } = await runCli(['unknown_command']);
      expect(exitCode).toBe(1);
    });

    it('catches errors and exits 1', async () => {
      mockPing.mockRejectedValue(new Error('connection failed'));
      const { exitCode, stderr } = await runCli(['ping']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('connection failed');
    });
  });

  describe('ping command', () => {
    it('calls client.ping and logs result', async () => {
      mockPing.mockResolvedValue({ version: '0.1.0', timestamp: '2025-01-01', echo: 'test' });
      const { stdout } = await runCli(['ping', 'test']);
      expect(mockPing).toHaveBeenCalledWith('test');
      expect(stdout).toContain('Pong!');
      expect(stdout).toContain('0.1.0');
    });
  });

  describe('http command', () => {
    it('calls client.httpRequest with method+url', async () => {
      mockHttpRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        body: 'hello',
      });
      const { stdout } = await runCli(['http', 'GET', 'https://example.com']);
      expect(mockHttpRequest).toHaveBeenCalledWith({
        url: 'https://example.com',
        method: 'GET',
        body: undefined,
      });
      expect(stdout).toContain('Status: 200');
    });

    it('exits 1 when args missing', async () => {
      const { exitCode } = await runCli(['http']);
      expect(exitCode).toBe(1);
    });

    it('supports --raw flag', async () => {
      mockHttpRequest.mockResolvedValue({
        status: 200,
        body: 'raw-body',
        headers: {},
      });
      // --raw mode uses process.stdout.write which we can't easily capture
      // but we can verify it doesn't crash and calls httpRequest
      await runCli(['http', '--raw', 'GET', 'https://example.com']);
      expect(mockHttpRequest).toHaveBeenCalled();
    });

    it('--raw flag exits 22 on HTTP error status', async () => {
      mockHttpRequest.mockResolvedValue({
        status: 500,
        body: 'error',
        headers: {},
      });
      const { exitCode } = await runCli(['http', '--raw', 'GET', 'https://example.com/fail']);
      expect(exitCode).toBe(22);
    });

    it('passes body argument to httpRequest', async () => {
      mockHttpRequest.mockResolvedValue({
        status: 201,
        statusText: 'Created',
        headers: {},
        body: 'created',
      });
      const { stdout } = await runCli(['http', 'POST', 'https://example.com/data', '{"key":"value"}']);
      expect(mockHttpRequest).toHaveBeenCalledWith({
        url: 'https://example.com/data',
        method: 'POST',
        body: '{"key":"value"}',
      });
      expect(stdout).toContain('Status: 201');
    });

    it('--raw with body passes body correctly', async () => {
      mockHttpRequest.mockResolvedValue({
        status: 200,
        body: 'ok',
        headers: {},
      });
      await runCli(['http', '--raw', 'POST', 'https://example.com', 'payload']);
      expect(mockHttpRequest).toHaveBeenCalledWith({
        url: 'https://example.com',
        method: 'POST',
        body: 'payload',
      });
    });
  });

  describe('file command', () => {
    it('file read calls client.fileRead', async () => {
      mockFileRead.mockResolvedValue({ content: 'file content' });
      const { stdout } = await runCli(['file', 'read', '/tmp/test.txt']);
      expect(mockFileRead).toHaveBeenCalledWith({ path: '/tmp/test.txt' });
      expect(stdout).toContain('file content');
    });

    it('file write calls client.fileWrite', async () => {
      mockFileWrite.mockResolvedValue({ bytesWritten: 11, path: '/tmp/out.txt' });
      const { stdout } = await runCli(['file', 'write', '/tmp/out.txt', 'hello', 'world']);
      expect(mockFileWrite).toHaveBeenCalledWith({ path: '/tmp/out.txt', content: 'hello world' });
      expect(stdout).toContain('11 bytes');
    });

    it('file list calls client.fileList', async () => {
      mockFileList.mockResolvedValue({
        entries: [
          { name: 'test.txt', type: 'file', size: 100 },
          { name: 'dir', type: 'directory', size: 0 },
        ],
      });
      const { stdout } = await runCli(['file', 'list', '/tmp']);
      expect(mockFileList).toHaveBeenCalledWith({ path: '/tmp', recursive: false });
      expect(stdout).toContain('test.txt');
    });

    it('file list supports --recursive', async () => {
      mockFileList.mockResolvedValue({ entries: [] });
      await runCli(['file', 'list', '/tmp', '--recursive']);
      expect(mockFileList).toHaveBeenCalledWith({ path: '/tmp', recursive: true });
    });

    it('file read exits 1 when path is missing', async () => {
      const { exitCode, stderr } = await runCli(['file', 'read']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Usage: shield-client file read');
    });

    it('file write exits 1 when content is missing', async () => {
      const { exitCode, stderr } = await runCli(['file', 'write', '/tmp/out.txt']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Usage: shield-client file write');
    });

    it('file write joins multiple content args with space', async () => {
      mockFileWrite.mockResolvedValue({ bytesWritten: 15, path: '/tmp/out.txt' });
      const { stdout } = await runCli(['file', 'write', '/tmp/out.txt', 'a', 'b', 'c']);
      expect(mockFileWrite).toHaveBeenCalledWith({ path: '/tmp/out.txt', content: 'a b c' });
      expect(stdout).toContain('15 bytes');
    });

    it('exits 1 for unknown file subcommand', async () => {
      const { exitCode } = await runCli(['file', 'unknown']);
      expect(exitCode).toBe(1);
    });
  });

  describe('exec command', () => {
    it('calls client.exec with command and args', async () => {
      mockExec.mockResolvedValue({ exitCode: 0, stdout: 'output', stderr: '' });
      const { exitCode } = await runCli(['exec', 'echo', 'hello']);
      expect(mockExec).toHaveBeenCalledWith({ command: 'echo', args: ['hello'] });
      expect(exitCode).toBe(0);
    });

    it('writes stderr output via process.stderr.write', async () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      mockExec.mockResolvedValue({ exitCode: 1, stdout: 'out', stderr: 'err-output' });
      try {
        await runCli(['exec', 'failing-cmd']);
        expect(stderrSpy).toHaveBeenCalledWith('err-output');
        expect(stdoutSpy).toHaveBeenCalledWith('out');
      } finally {
        stderrSpy.mockRestore();
        stdoutSpy.mockRestore();
      }
    });

    it('exits 1 when command is missing', async () => {
      const { exitCode } = await runCli(['exec']);
      expect(exitCode).toBe(1);
    });
  });

  describe('open command', () => {
    it('calls client.openUrl', async () => {
      mockOpenUrl.mockResolvedValue({ opened: true });
      const { stdout } = await runCli(['open', 'https://example.com']);
      expect(mockOpenUrl).toHaveBeenCalledWith({ url: 'https://example.com' });
      expect(stdout).toContain('opened successfully');
    });

    it('exits 1 when url is missing', async () => {
      const { exitCode } = await runCli(['open']);
      expect(exitCode).toBe(1);
    });
  });

  describe('secret command', () => {
    it('calls client.secretInject for get', async () => {
      mockSecretInject.mockResolvedValue({ value: 'secret-value' });
      const { stdout } = await runCli(['secret', 'get', 'MY_KEY']);
      expect(mockSecretInject).toHaveBeenCalledWith({ name: 'MY_KEY' });
      expect(stdout).toContain('secret-value');
    });

    it('exits 1 for invalid subcommand', async () => {
      const { exitCode } = await runCli(['secret', 'invalid']);
      expect(exitCode).toBe(1);
    });

    it('exits 1 when name is missing for secret get', async () => {
      const { exitCode, stderr } = await runCli(['secret', 'get']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Usage: shield-client secret get');
    });
  });

  describe('check-exec command', () => {
    it('exits 0 when allowed', async () => {
      mockPolicyCheck.mockResolvedValue({ allowed: true });
      const { exitCode } = await runCli(['check-exec', 'node']);
      expect(mockPolicyCheck).toHaveBeenCalledWith({ operation: 'exec', target: 'node' });
      expect(exitCode).toBe(0);
    });

    it('exits 126 when denied', async () => {
      mockPolicyCheck.mockResolvedValue({ allowed: false });
      const { exitCode } = await runCli(['check-exec', 'evil']);
      expect(exitCode).toBe(126);
    });

    it('exits 1 when target is missing', async () => {
      const { exitCode } = await runCli(['check-exec']);
      expect(exitCode).toBe(1);
    });
  });

  describe('check-pkg command', () => {
    it('exits 0 when allowed', async () => {
      mockPolicyCheck.mockResolvedValue({ allowed: true });
      const { exitCode } = await runCli(['check-pkg', 'npm', 'lodash']);
      expect(mockPolicyCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'npm:lodash',
        })
      );
      expect(exitCode).toBe(0);
    });

    it('exits 126 when denied', async () => {
      mockPolicyCheck.mockResolvedValue({ allowed: false });
      const { exitCode } = await runCli(['check-pkg', 'npm', 'evil-pkg']);
      expect(exitCode).toBe(126);
    });

    it('exits 1 when manager or package is missing', async () => {
      const { exitCode: e1, stderr: s1 } = await runCli(['check-pkg']);
      expect(e1).toBe(1);
      expect(s1).toContain('Usage: shield-client check-pkg');

      const { exitCode: e2, stderr: s2 } = await runCli(['check-pkg', 'npm']);
      expect(e2).toBe(1);
      expect(s2).toContain('Usage: shield-client check-pkg');
    });
  });

  describe('skill run command', () => {
    it('exits 1 when binary not found', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);
      const origHome = process.env['AGENSHIELD_AGENT_HOME'];
      process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
      try {
        const { exitCode, stderr } = await runCli(['skill', 'run', 'test-skill']);
        expect(exitCode).toBe(1);
        expect(stderr).toContain('Could not find binary');
      } finally {
        if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
        else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
      }
    });

    it('exits 1 for invalid skill subcommand', async () => {
      const { exitCode } = await runCli(['skill', 'invalid']);
      expect(exitCode).toBe(1);
    });

    it('exits 1 when slug is missing for skill run', async () => {
      const { exitCode, stderr } = await runCli(['skill', 'run']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Usage: shield-client skill run');
    });

    it('handles child process error event', async () => {
      const origHome = process.env['AGENSHIELD_AGENT_HOME'];
      process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
      const origArgv = process.argv;
      const origExit = process.exit;
      let exitCode: number | null = null;
      let stderr = '';
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...msgArgs) => {
        stderr += msgArgs.join(' ') + '\n';
      });
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        (existsSync as jest.Mock).mockImplementation((p: string) => {
          return p === '/opt/agent/bin/.brew-originals/err-skill';
        });

        const mockProc = new EventEmitter() as any;
        mockProc.stdin = null;
        mockProc.stdout = null;
        mockProc.stderr = null;
        (spawn as jest.Mock).mockImplementation(() => {
          // Schedule the error emission after listeners are registered
          setTimeout(() => mockProc.emit('error', new Error('spawn ENOENT')), 10);
          return mockProc;
        });

        process.argv = ['node', 'shield-client', 'skill', 'run', 'err-skill'];
        // Non-throwing exit mock — just record the code
        process.exit = ((code: number) => { if (exitCode === null) exitCode = code; }) as any;

        await jest.isolateModulesAsync(async () => {
          try {
            await import('../../client/shield-client.js');
            await new Promise((r) => setTimeout(r, 100));
          } catch {
            // swallow
          }
        });

        expect(exitCode).toBe(1);
        expect(stderr).toContain('Error executing skill');
      } finally {
        process.argv = origArgv;
        process.exit = origExit;
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
        if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
        else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
      }
    });

    it('handles child process exit with signal', async () => {
      const origHome = process.env['AGENSHIELD_AGENT_HOME'];
      process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
      const origArgv = process.argv;
      const origExit = process.exit;
      const origKill = process.kill;
      let killCalled = false;
      let killSignal: string | undefined;
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        (existsSync as jest.Mock).mockImplementation((p: string) => {
          return p === '/opt/agent/bin/.brew-originals/sig-skill';
        });

        const mockProc = new EventEmitter() as any;
        mockProc.stdin = null;
        mockProc.stdout = null;
        mockProc.stderr = null;
        (spawn as jest.Mock).mockImplementation(() => {
          setTimeout(() => mockProc.emit('exit', null, 'SIGTERM'), 10);
          return mockProc;
        });

        process.argv = ['node', 'shield-client', 'skill', 'run', 'sig-skill'];
        process.exit = (() => {}) as any;
        process.kill = ((pid: number, sig: string) => {
          killCalled = true;
          killSignal = sig;
        }) as any;

        await jest.isolateModulesAsync(async () => {
          try {
            await import('../../client/shield-client.js');
            await new Promise((r) => setTimeout(r, 100));
          } catch {
            // swallow
          }
        });

        expect(killCalled).toBe(true);
        expect(killSignal).toBe('SIGTERM');
      } finally {
        process.argv = origArgv;
        process.exit = origExit;
        process.kill = origKill;
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
        else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
      }
    });

    it('handles child process exit with code', async () => {
      const origHome = process.env['AGENSHIELD_AGENT_HOME'];
      process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
      const origArgv = process.argv;
      const origExit = process.exit;
      let exitCode: number | null = null;
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        (existsSync as jest.Mock).mockImplementation((p: string) => {
          return p === '/opt/agent/bin/.brew-originals/exit-skill';
        });

        const mockProc = new EventEmitter() as any;
        mockProc.stdin = null;
        mockProc.stdout = null;
        mockProc.stderr = null;
        (spawn as jest.Mock).mockImplementation(() => {
          setTimeout(() => mockProc.emit('exit', 42, null), 10);
          return mockProc;
        });

        process.argv = ['node', 'shield-client', 'skill', 'run', 'exit-skill'];
        process.exit = ((code: number) => { if (exitCode === null) exitCode = code; }) as any;

        await jest.isolateModulesAsync(async () => {
          try {
            await import('../../client/shield-client.js');
            await new Promise((r) => setTimeout(r, 100));
          } catch {
            // swallow
          }
        });

        expect(exitCode).toBe(42);
      } finally {
        process.argv = origArgv;
        process.exit = origExit;
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
        else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
      }
    });
  });
});

// Test pure utility functions separately by importing them
describe('stripKnownPrefix', () => {
  // Access via the module's exports (these are file-level functions not exported,
  // so we test them indirectly via findSkillBinary behavior)

  it('strips known oc- prefix and finds binary in brew-originals', async () => {
    const origHome = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
    const origPath = process.env['PATH'];
    process.env['PATH'] = '/usr/bin';
    try {
      (existsSync as jest.Mock).mockImplementation((p: string) => {
        // Only the stripped name in brew-originals should match
        return p === '/opt/agent/bin/.brew-originals/gog';
      });

      const mockProc = new EventEmitter() as any;
      mockProc.stdin = null;
      mockProc.stdout = null;
      mockProc.stderr = null;
      (spawn as jest.Mock).mockReturnValue(mockProc);

      await runCli(['skill', 'run', 'oc-gog']);

      expect(spawn).toHaveBeenCalled();
      expect((spawn as jest.Mock).mock.calls[0][0]).toBe('/opt/agent/bin/.brew-originals/gog');
    } finally {
      if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
      else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
      process.env['PATH'] = origPath;
    }
  });

  it('strips known prefix and finds binary on PATH', async () => {
    const origHome = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
    const origPath = process.env['PATH'];
    process.env['PATH'] = '/opt/agent/bin:/usr/local/bin';
    try {
      (existsSync as jest.Mock).mockImplementation((p: string) => {
        // Only the stripped name on PATH should match
        return p === '/usr/local/bin/myapp';
      });

      const mockProc = new EventEmitter() as any;
      mockProc.stdin = null;
      mockProc.stdout = null;
      mockProc.stderr = null;
      (spawn as jest.Mock).mockReturnValue(mockProc);

      await runCli(['skill', 'run', 'ch-myapp']);

      expect(spawn).toHaveBeenCalled();
      expect((spawn as jest.Mock).mock.calls[0][0]).toBe('/usr/local/bin/myapp');
    } finally {
      if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
      else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
      process.env['PATH'] = origPath;
    }
  });

  it('does not strip prefix when slug equals prefix length (no remaining name)', async () => {
    const origHome = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
    const origPath = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      (existsSync as jest.Mock).mockReturnValue(false);

      // "oc-" is exactly the prefix with nothing after it — stripKnownPrefix returns null
      const { exitCode, stderr } = await runCli(['skill', 'run', 'oc-']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Could not find binary');
    } finally {
      if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
      else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
      process.env['PATH'] = origPath;
    }
  });
});

describe('findSkillBinary', () => {
  it('finds in .brew-originals and spawns correct path', async () => {
    const origHome = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
    try {
      (existsSync as jest.Mock).mockImplementation((p: string) => {
        return p === '/opt/agent/bin/.brew-originals/my-skill';
      });

      const mockProc = new EventEmitter() as any;
      mockProc.stdin = null;
      mockProc.stdout = null;
      mockProc.stderr = null;
      (spawn as jest.Mock).mockReturnValue(mockProc);

      // runCli will hang because handleSkillRun awaits a never-resolving promise,
      // but the 100ms timeout in runCli will let isolateModulesAsync return.
      // We just need to verify spawn was called with the right path.
      const result = await runCli(['skill', 'run', 'my-skill']);

      // spawn should have been called with the brew-originals path
      expect(spawn).toHaveBeenCalled();
      expect((spawn as jest.Mock).mock.calls[0][0]).toBe('/opt/agent/bin/.brew-originals/my-skill');
    } finally {
      if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
      else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
    }
  });

  it('finds on PATH excluding wrapper dir', async () => {
    const origHome = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
    const origPath = process.env['PATH'];
    process.env['PATH'] = '/opt/agent/bin:/usr/local/bin';
    try {
      (existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes('.brew-originals')) return false;
        return p === '/usr/local/bin/my-skill';
      });

      const mockProc = new EventEmitter() as any;
      mockProc.stdin = null;
      mockProc.stdout = null;
      mockProc.stderr = null;
      (spawn as jest.Mock).mockReturnValue(mockProc);

      await runCli(['skill', 'run', 'my-skill']);

      expect(spawn).toHaveBeenCalled();
      expect((spawn as jest.Mock).mock.calls[0][0]).toBe('/usr/local/bin/my-skill');
    } finally {
      if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
      else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
      process.env['PATH'] = origPath;
    }
  });

  it('returns null when not found', async () => {
    const origHome = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
    try {
      (existsSync as jest.Mock).mockReturnValue(false);
      const { exitCode } = await runCli(['skill', 'run', 'nonexistent']);
      expect(exitCode).toBe(1);
    } finally {
      if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
      else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
    }
  });
});
