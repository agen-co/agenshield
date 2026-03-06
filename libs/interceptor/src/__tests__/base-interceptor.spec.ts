/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../debug-log', () => ({
  debugLog: jest.fn(),
}));

import { BaseInterceptor, type BaseInterceptorOptions } from '../interceptors/base';
import { PolicyDeniedError, BrokerUnavailableError } from '../errors';

// Concrete subclass for testing
class TestInterceptor extends BaseInterceptor {
  install(): void { this.installed = true; }
  uninstall(): void { this.installed = false; }

  // Expose protected methods for testing
  public testIsBrokerUrl(url: string) { return this.isBrokerUrl(url); }
  public testGetBasePolicyExecutionContext() { return this.getBasePolicyExecutionContext(); }
  public testCheckPolicy(op: string, target: string, ctx?: any) { return this.checkPolicy(op, target, ctx); }
  public testDebug(msg: string) { return this.debug(msg); }
}

function createInterceptor(overrides?: Partial<BaseInterceptorOptions>) {
  const defaults: BaseInterceptorOptions = {
    client: { request: jest.fn() } as any,
    policyEvaluator: { check: jest.fn() } as any,
    eventReporter: {
      intercept: jest.fn(),
      allow: jest.fn(),
      deny: jest.fn(),
      error: jest.fn(),
    } as any,
    failOpen: false,
    brokerHttpPort: 5201,
    ...overrides,
  };
  return new TestInterceptor(defaults);
}

describe('BaseInterceptor', () => {
  describe('isBrokerUrl', () => {
    it('returns true for localhost + broker port', () => {
      const i = createInterceptor({ brokerHttpPort: 5201 });
      expect(i.testIsBrokerUrl('http://localhost:5201/rpc')).toBe(true);
      expect(i.testIsBrokerUrl('http://127.0.0.1:5201/rpc')).toBe(true);
    });

    it('returns true for daemon port 5200', () => {
      const i = createInterceptor();
      expect(i.testIsBrokerUrl('http://localhost:5200/status')).toBe(true);
    });

    it('returns false for external hosts', () => {
      const i = createInterceptor();
      expect(i.testIsBrokerUrl('https://api.example.com:5201/rpc')).toBe(false);
    });

    it('returns false for localhost + other port', () => {
      const i = createInterceptor();
      expect(i.testIsBrokerUrl('http://localhost:8080/api')).toBe(false);
    });

    it('returns false for invalid URL', () => {
      const i = createInterceptor();
      expect(i.testIsBrokerUrl('not-a-url')).toBe(false);
    });

    it('uses custom broker port', () => {
      const i = createInterceptor({ brokerHttpPort: 9999 });
      expect(i.testIsBrokerUrl('http://localhost:9999/rpc')).toBe(true);
      expect(i.testIsBrokerUrl('http://localhost:5201/rpc')).toBe(false);
    });

    it('defaults broker port to 5201', () => {
      const i = createInterceptor({ brokerHttpPort: undefined });
      expect(i.testIsBrokerUrl('http://localhost:5201/rpc')).toBe(true);
    });
  });

  describe('isInstalled', () => {
    it('returns false initially', () => {
      const i = createInterceptor();
      expect(i.isInstalled()).toBe(false);
    });

    it('returns true after install', () => {
      const i = createInterceptor();
      i.install();
      expect(i.isInstalled()).toBe(true);
    });
  });

  describe('getBasePolicyExecutionContext', () => {
    it('returns undefined when no config', () => {
      const i = createInterceptor({ config: undefined });
      expect(i.testGetBasePolicyExecutionContext()).toBeUndefined();
    });

    it('returns context from config', () => {
      const i = createInterceptor({
        config: {
          contextType: 'skill',
          contextSkillSlug: 'my-skill',
          contextAgentId: 'agent-1',
        } as any,
      });
      const ctx = i.testGetBasePolicyExecutionContext();
      expect(ctx).toEqual({
        callerType: 'skill',
        skillSlug: 'my-skill',
        agentId: 'agent-1',
        depth: 0,
      });
    });
  });

  describe('checkPolicy', () => {
    it('resolves when policy is allowed', async () => {
      const mockEvaluator = {
        check: jest.fn().mockResolvedValue({ allowed: true, policyId: 'p1' }),
      };
      const mockReporter = {
        intercept: jest.fn(),
        allow: jest.fn(),
        deny: jest.fn(),
        error: jest.fn(),
      };
      const i = createInterceptor({
        policyEvaluator: mockEvaluator as any,
        eventReporter: mockReporter as any,
      });

      await expect(i.testCheckPolicy('exec', 'ls')).resolves.toBeUndefined();
      expect(mockReporter.intercept).toHaveBeenCalledWith('exec', 'ls');
      expect(mockReporter.allow).toHaveBeenCalledWith('exec', 'ls', 'p1', expect.any(Number));
    });

    it('throws PolicyDeniedError when policy is denied', async () => {
      const mockEvaluator = {
        check: jest.fn().mockResolvedValue({
          allowed: false,
          policyId: 'deny-policy',
          reason: 'blocked',
        }),
      };
      const mockReporter = {
        intercept: jest.fn(),
        allow: jest.fn(),
        deny: jest.fn(),
        error: jest.fn(),
      };
      const i = createInterceptor({
        policyEvaluator: mockEvaluator as any,
        eventReporter: mockReporter as any,
      });

      await expect(i.testCheckPolicy('exec', 'rm -rf /')).rejects.toThrow(PolicyDeniedError);
      expect(mockReporter.deny).toHaveBeenCalledWith('exec', 'rm -rf /', 'deny-policy', 'blocked');
    });

    it('fails open when evaluator throws and failOpen=true', async () => {
      const mockEvaluator = {
        check: jest.fn().mockRejectedValue(new Error('broker down')),
      };
      const mockReporter = {
        intercept: jest.fn(),
        allow: jest.fn(),
        deny: jest.fn(),
        error: jest.fn(),
      };
      const i = createInterceptor({
        policyEvaluator: mockEvaluator as any,
        eventReporter: mockReporter as any,
        failOpen: true,
      });

      await expect(i.testCheckPolicy('exec', 'ls')).resolves.toBeUndefined();
      expect(mockReporter.error).toHaveBeenCalledWith(
        'exec',
        'ls',
        expect.stringContaining('broker down')
      );
    });

    it('throws BrokerUnavailableError when evaluator throws and failOpen=false', async () => {
      const mockEvaluator = {
        check: jest.fn().mockRejectedValue(new Error('broker down')),
      };
      const mockReporter = {
        intercept: jest.fn(),
        allow: jest.fn(),
        deny: jest.fn(),
        error: jest.fn(),
      };
      const i = createInterceptor({
        policyEvaluator: mockEvaluator as any,
        eventReporter: mockReporter as any,
        failOpen: false,
      });

      await expect(i.testCheckPolicy('exec', 'ls')).rejects.toThrow(BrokerUnavailableError);
    });

    it('re-throws PolicyDeniedError without wrapping', async () => {
      const mockEvaluator = {
        check: jest.fn().mockResolvedValue({ allowed: false, reason: 'no' }),
      };
      const i = createInterceptor({
        policyEvaluator: mockEvaluator as any,
        eventReporter: {
          intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(), error: jest.fn(),
        } as any,
        failOpen: true, // Even with failOpen, PolicyDeniedError should still throw
      });

      await expect(i.testCheckPolicy('exec', 'x')).rejects.toThrow(PolicyDeniedError);
    });
  });

  describe('debug', () => {
    it('logs to console.debug with class name prefix', () => {
      const spy = jest.spyOn(console, 'debug').mockImplementation();
      const i = createInterceptor();
      i.testDebug('test message');
      expect(spy).toHaveBeenCalledWith('[AgenShield:TestInterceptor] test message');
      spy.mockRestore();
    });
  });
});
