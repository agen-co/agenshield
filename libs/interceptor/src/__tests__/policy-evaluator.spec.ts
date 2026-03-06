/* eslint-disable @typescript-eslint/no-explicit-any */

import { PolicyEvaluator } from '../policy/evaluator';

describe('PolicyEvaluator', () => {
  it('returns the result from client.request on success', async () => {
    const mockClient = {
      request: jest.fn().mockResolvedValue({ allowed: true, policyId: 'p1' }),
    };

    const evaluator = new PolicyEvaluator({ client: mockClient as any });
    const result = await evaluator.check('http_request', 'https://example.com');

    expect(result).toEqual({ allowed: true, policyId: 'p1' });
    expect(mockClient.request).toHaveBeenCalledWith(
      'policy_check',
      { operation: 'http_request', target: 'https://example.com', context: undefined }
    );
  });

  it('passes context to client.request', async () => {
    const mockClient = {
      request: jest.fn().mockResolvedValue({ allowed: true }),
    };

    const context = { callerType: 'skill' as const, skillSlug: 'my-skill', depth: 1 };
    const evaluator = new PolicyEvaluator({ client: mockClient as any });
    await evaluator.check('exec', 'ls', context);

    expect(mockClient.request).toHaveBeenCalledWith(
      'policy_check',
      { operation: 'exec', target: 'ls', context }
    );
  });

  it('returns denied result when client throws', async () => {
    const mockClient = {
      request: jest.fn().mockRejectedValue(new Error('connection refused')),
    };

    const evaluator = new PolicyEvaluator({ client: mockClient as any });
    const result = await evaluator.check('http_request', 'https://evil.com');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('connection refused');
  });
});
