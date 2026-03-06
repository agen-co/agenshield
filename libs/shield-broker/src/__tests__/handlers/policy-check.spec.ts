import { handlePolicyCheck } from '../../handlers/policy-check.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

const mockForwardPolicy = jest.fn();

jest.mock('../../daemon-forward.js', () => ({
  forwardPolicyToDaemon: (...args: unknown[]) => mockForwardPolicy(...args),
  forwardEventsToDaemon: jest.fn(),
  forwardOpenUrlToDaemon: jest.fn(),
}));

describe('handlePolicyCheck', () => {
  const ctx = createHandlerContext();

  beforeEach(() => {
    jest.clearAllMocks();
    mockForwardPolicy.mockResolvedValue(null);
  });

  it('should return error when operation is missing', async () => {
    const result = await handlePolicyCheck({}, ctx, createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(-32602);
  });

  it('should map http_request target to { url }', async () => {
    const deps = createMockDeps();
    await handlePolicyCheck({ operation: 'http_request', target: 'https://example.com' }, ctx, deps);
    expect(deps.policyEnforcer.check).toHaveBeenCalledWith(
      'http_request',
      { url: 'https://example.com' },
      ctx
    );
  });

  it('should map file_read target to { path }', async () => {
    const deps = createMockDeps();
    await handlePolicyCheck({ operation: 'file_read', target: '/tmp/file.txt' }, ctx, deps);
    expect(deps.policyEnforcer.check).toHaveBeenCalledWith(
      'file_read',
      { path: '/tmp/file.txt' },
      ctx
    );
  });

  it('should map exec target to { command }', async () => {
    const deps = createMockDeps();
    await handlePolicyCheck({ operation: 'exec', target: 'node index.js' }, ctx, deps);
    expect(deps.policyEnforcer.check).toHaveBeenCalledWith(
      'exec',
      { command: 'node index.js' },
      ctx
    );
  });

  it('should map unknown operation target to { target }', async () => {
    const deps = createMockDeps();
    await handlePolicyCheck({ operation: 'custom_op', target: 'something' }, ctx, deps);
    expect(deps.policyEnforcer.check).toHaveBeenCalledWith(
      'custom_op',
      { target: 'something' },
      ctx
    );
  });

  describe('broker allows', () => {
    it('non-exec/http should return allowed without daemon forward', async () => {
      const deps = createMockDeps();
      (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({ allowed: true, policyId: 'p1' });
      const result = await handlePolicyCheck({ operation: 'file_read', target: '/tmp/test' }, ctx, deps);
      expect(result.data!.allowed).toBe(true);
      expect(result.data!.policyId).toBe('p1');
      expect(mockForwardPolicy).not.toHaveBeenCalled();
    });

    it('exec should forward to daemon for sandbox config', async () => {
      const deps = createMockDeps();
      (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({ allowed: true });
      mockForwardPolicy.mockResolvedValue({
        allowed: true,
        policyId: 'daemon-policy',
        sandbox: { profile: 'strict' },
      });
      const result = await handlePolicyCheck({ operation: 'exec', target: 'node app.js' }, ctx, deps);
      expect(mockForwardPolicy).toHaveBeenCalled();
      expect(result.data!.sandbox).toEqual({ profile: 'strict' });
      expect(result.data!.policyId).toBe('daemon-policy');
    });

    it('http_request should forward to daemon', async () => {
      const deps = createMockDeps();
      (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({ allowed: true });
      await handlePolicyCheck({ operation: 'http_request', target: 'https://example.com' }, ctx, deps);
      expect(mockForwardPolicy).toHaveBeenCalled();
    });

    it('exec with daemon returning null should use broker result', async () => {
      const deps = createMockDeps();
      (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({ allowed: true, policyId: 'broker-p' });
      mockForwardPolicy.mockResolvedValue(null);
      const result = await handlePolicyCheck({ operation: 'exec', target: 'node' }, ctx, deps);
      expect(result.data!.allowed).toBe(true);
      expect(result.data!.policyId).toBe('broker-p');
    });
  });

  describe('broker denies', () => {
    it('should forward to daemon, daemon allows → return allowed', async () => {
      const deps = createMockDeps();
      (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({ allowed: false, policyId: 'deny-rule' });
      mockForwardPolicy.mockResolvedValue({ allowed: true, policyId: 'user-allow' });
      const result = await handlePolicyCheck({ operation: 'exec', target: 'test' }, ctx, deps);
      expect(result.data!.allowed).toBe(true);
      expect(result.data!.policyId).toBe('user-allow');
    });

    it('should keep broker denial when daemon returns null', async () => {
      const deps = createMockDeps();
      (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({
        allowed: false,
        policyId: 'deny-rule',
        reason: 'Denied by policy: test',
      });
      mockForwardPolicy.mockResolvedValue(null);
      const result = await handlePolicyCheck({ operation: 'exec', target: 'test' }, ctx, deps);
      expect(result.data!.allowed).toBe(false);
      expect(result.data!.policyId).toBe('deny-rule');
      expect(result.data!.reason).toContain('Denied');
    });
  });

  it('should pass executionContext through to daemon forward', async () => {
    const deps = createMockDeps();
    (deps.policyEnforcer.check as jest.Mock).mockResolvedValue({ allowed: true });
    const execCtx = { source: 'test' };
    await handlePolicyCheck(
      { operation: 'exec', target: 'node', context: execCtx },
      ctx,
      deps
    );
    expect(mockForwardPolicy).toHaveBeenCalledWith(
      'exec', 'node', expect.any(String), execCtx, undefined
    );
  });

  it('should map secret_inject target to { name }', async () => {
    const deps = createMockDeps();
    await handlePolicyCheck({ operation: 'secret_inject', target: 'MY_SECRET' }, ctx, deps);
    expect(deps.policyEnforcer.check).toHaveBeenCalledWith(
      'secret_inject',
      { name: 'MY_SECRET' },
      ctx
    );
  });
});
