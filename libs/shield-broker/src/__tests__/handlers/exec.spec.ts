import { handleExec } from '../../handlers/exec.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

const mockForwardPolicy = jest.fn();

jest.mock('../../daemon-forward.js', () => ({
  forwardPolicyToDaemon: (...args: unknown[]) => mockForwardPolicy(...args),
  forwardEventsToDaemon: jest.fn(),
  forwardOpenUrlToDaemon: jest.fn(),
}));

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  cp: jest.fn().mockResolvedValue(undefined),
  utimes: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
}));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fsp from 'node:fs/promises';

function createMockProcess(exitCode = 0, stdout = '', stderr = '') {
  const proc = new EventEmitter() as any;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  proc.stdout = stdoutEmitter;
  proc.stderr = stderrEmitter;
  proc.killed = false;
  proc.kill = jest.fn(() => { proc.killed = true; });

  // Schedule data + close events
  setImmediate(() => {
    if (stdout) stdoutEmitter.emit('data', Buffer.from(stdout));
    if (stderr) stderrEmitter.emit('data', Buffer.from(stderr));
    proc.emit('exit', exitCode, null);
    proc.emit('close', exitCode, null);
  });
  return proc;
}

describe('handleExec', () => {
  const ctx = createHandlerContext();

  beforeEach(() => {
    jest.clearAllMocks();
    mockForwardPolicy.mockResolvedValue(null);
    (spawn as jest.Mock).mockReturnValue(createMockProcess());
  });

  describe('input validation', () => {
    it('should return error 1003 when command is missing', async () => {
      const result = await handleExec({}, ctx, createMockDeps());
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe(1003);
    });
  });

  describe('allowlist validation', () => {
    it('should return error 1007 when command not in allowlist', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue(null);
      const result = await handleExec({ command: 'forbidden' }, ctx, deps);
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe(1007);
    });

    it('should call onExecDenied when command not allowed', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue(null);
      await handleExec({ command: 'forbidden' }, ctx, deps);
      expect(deps.onExecDenied).toHaveBeenCalledWith('forbidden', expect.stringContaining('not allowed'));
    });
  });

  describe('FS path enforcement', () => {
    it('should deny paths outside allowedPaths for FS commands', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/rm');
      (deps.policyEnforcer.getPolicies as jest.Mock).mockReturnValue({
        fsConstraints: { allowedPaths: ['/home/agent'] },
      });
      const result = await handleExec(
        { command: 'rm', args: ['/etc/passwd'] },
        ctx,
        deps
      );
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe(1008);
    });

    it('should allow paths within allowedPaths', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/rm');
      (deps.policyEnforcer.getPolicies as jest.Mock).mockReturnValue({
        fsConstraints: { allowedPaths: ['/home/agent'] },
      });
      const result = await handleExec(
        { command: 'rm', args: ['/home/agent/tmp/file.txt'] },
        ctx,
        deps
      );
      expect(result.success).toBe(true);
    });

    it('should skip flags when checking paths', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/rm');
      (deps.policyEnforcer.getPolicies as jest.Mock).mockReturnValue({
        fsConstraints: { allowedPaths: ['/home/agent'] },
      });
      const result = await handleExec(
        { command: 'rm', args: ['-rf', '/home/agent/tmp'] },
        ctx,
        deps
      );
      expect(result.success).toBe(true);
    });
  });

  describe('URL validation for curl/wget', () => {
    it('should validate URL against enforcer for curl', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/curl');
      (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({ allowed: false, reason: 'blocked' });
      mockForwardPolicy.mockResolvedValue(null);

      const result = await handleExec(
        { command: 'curl', args: ['https://evil.com'] },
        ctx,
        deps
      );
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe(1009);
    });

    it('should allow when daemon overrides URL denial', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/curl');
      (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({ allowed: false });
      mockForwardPolicy.mockResolvedValue({ allowed: true });

      const result = await handleExec(
        { command: 'curl', args: ['https://allowed-by-daemon.com'] },
        ctx,
        deps
      );
      expect(result.success).toBe(true);
    });

    it('should skip flag values when extracting URL', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/curl');
      (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({ allowed: true });

      await handleExec(
        { command: 'curl', args: ['-H', 'Content-Type: json', 'https://example.com'] },
        ctx,
        deps
      );
      expect(deps.policyEnforcer.check).toHaveBeenCalledWith(
        'http_request',
        { url: 'https://example.com' },
        ctx
      );
    });

    it('should handle curl with only flags (no URL found)', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/curl');
      // When no URL is found, skip URL check and execute
      const result = await handleExec(
        { command: 'curl', args: ['-X', 'POST'] },
        ctx,
        deps
      );
      // Should not call policyEnforcer.check for http_request (no URL to check)
      expect(deps.policyEnforcer.check).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('NODE_BUILTINS', () => {
    it('should use Node.js mkdir builtin', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/mkdir');
      (deps.policyEnforcer.getPolicies as jest.Mock).mockReturnValue({
        fsConstraints: { allowedPaths: ['/'] },
      });

      const result = await handleExec(
        { command: 'mkdir', args: ['-p', '/tmp/test-dir'] },
        ctx,
        deps
      );
      expect(result.success).toBe(true);
      expect(fsp.mkdir).toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should use Node.js rm builtin', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/rm');
      (deps.policyEnforcer.getPolicies as jest.Mock).mockReturnValue({
        fsConstraints: { allowedPaths: ['/'] },
      });

      const result = await handleExec(
        { command: 'rm', args: ['-rf', '/tmp/test'] },
        ctx,
        deps
      );
      expect(result.success).toBe(true);
      expect(fsp.rm).toHaveBeenCalled();
    });

    it('cp should return error for insufficient args', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/cp');
      (deps.policyEnforcer.getPolicies as jest.Mock).mockReturnValue({
        fsConstraints: { allowedPaths: ['/'] },
      });

      const result = await handleExec(
        { command: 'cp', args: ['src-only'] },
        ctx,
        deps
      );
      expect(result.success).toBe(true);
      expect(result.data!.exitCode).toBe(1);
      expect(result.data!.stderr).toContain('missing operand');
    });

    it('should use Node.js touch builtin (utimes fail → writeFile)', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/touch');
      (deps.policyEnforcer.getPolicies as jest.Mock).mockReturnValue({
        fsConstraints: { allowedPaths: ['/'] },
      });
      (fsp.utimes as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const result = await handleExec(
        { command: 'touch', args: ['/tmp/newfile'] },
        ctx,
        deps
      );
      expect(result.success).toBe(true);
      expect(fsp.writeFile).toHaveBeenCalled();
    });

    it('should use Node.js chmod builtin with octal mode', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/bin/chmod');
      (deps.policyEnforcer.getPolicies as jest.Mock).mockReturnValue({
        fsConstraints: { allowedPaths: ['/'] },
      });

      const result = await handleExec(
        { command: 'chmod', args: ['755', '/tmp/script.sh'] },
        ctx,
        deps
      );
      expect(result.success).toBe(true);
      expect(fsp.chmod).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/script.sh'),
        0o755
      );
    });

    it('should fall back to spawn when builtin throws', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/bin/mkdir');
      (deps.policyEnforcer.getPolicies as jest.Mock).mockReturnValue({
        fsConstraints: { allowedPaths: ['/'] },
      });
      (fsp.mkdir as jest.Mock).mockRejectedValue(new Error('builtin failed'));

      const result = await handleExec(
        { command: 'mkdir', args: ['/tmp/test'] },
        ctx,
        deps
      );
      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalled();
    });
  });

  describe('execution', () => {
    it('should call onExecMonitor after execution', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/node');

      await handleExec({ command: 'node', args: ['--version'] }, ctx, deps);
      expect(deps.onExecMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'node',
          args: ['--version'],
          allowed: true,
        })
      );
    });

    it('should merge secret env vars', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/node');
      (deps.secretResolver!.getSecretsForExec as jest.Mock).mockReturnValue({ API_KEY: 'secret' });

      await handleExec({ command: 'node', args: [] }, ctx, deps);
      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/node',
        [],
        expect.objectContaining({
          env: expect.objectContaining({ API_KEY: 'secret' }),
        })
      );
    });

    it('should return exitCode, stdout, stderr', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/echo');
      (spawn as jest.Mock).mockReturnValue(createMockProcess(0, 'hello\n', ''));

      const result = await handleExec({ command: 'echo', args: ['hello'] }, ctx, deps);
      expect(result.success).toBe(true);
      expect(result.data!.exitCode).toBe(0);
      expect(result.data!.stdout).toBe('hello\n');
    });

    it('should return error 1006 on spawn error', async () => {
      const deps = createMockDeps();
      (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/bad');
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.killed = false;
      proc.kill = jest.fn();
      (spawn as jest.Mock).mockReturnValue(proc);
      setImmediate(() => proc.emit('error', new Error('spawn failed')));

      const result = await handleExec({ command: 'bad', args: [] }, ctx, deps);
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe(1006);
    });

    it('should use AGENSHIELD_AGENT_HOME for default workspace', async () => {
      const origHome = process.env['AGENSHIELD_AGENT_HOME'];
      process.env['AGENSHIELD_AGENT_HOME'] = '/opt/agent';
      try {
        const deps = createMockDeps();
        (deps.commandAllowlist.resolve as jest.Mock).mockReturnValue('/usr/bin/echo');
        await handleExec({ command: 'echo', args: ['test'] }, ctx, deps);
        expect(spawn).toHaveBeenCalledWith(
          '/usr/bin/echo',
          ['test'],
          expect.objectContaining({
            cwd: '/opt/agent/.openclaw/workspace',
          })
        );
      } finally {
        if (origHome === undefined) delete process.env['AGENSHIELD_AGENT_HOME'];
        else process.env['AGENSHIELD_AGENT_HOME'] = origHome;
      }
    });
  });
});
