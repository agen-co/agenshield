/**
 * PolicyManager — integration tests with mocked storage
 */

import { PolicyManager } from '../manager';
import type { PolicyManagerOptions } from '../manager';
import type { PolicyConfig } from '@agenshield/ipc';
import { makePolicy } from './helpers';

// ─── Mock Storage ─────────────────────────────────────────────

function createMockStorage(initialPolicies: PolicyConfig[] = []) {
  const policies = [...initialPolicies];
  let nextId = 1;

  const policiesRepo = {
    create: jest.fn((input: Partial<PolicyConfig>) => {
      const p: PolicyConfig = {
        id: input.id ?? `p-${nextId++}`,
        name: input.name ?? 'New',
        action: input.action ?? 'allow',
        target: input.target ?? 'url',
        patterns: input.patterns ?? [],
        enabled: input.enabled ?? true,
        priority: input.priority ?? 0,
        ...input,
      } as PolicyConfig;
      policies.push(p);
      return p;
    }),
    getById: jest.fn((id: string) => policies.find(p => p.id === id) ?? null),
    getAll: jest.fn(() => [...policies]),
    getEnabled: jest.fn(() => policies.filter(p => p.enabled)),
    update: jest.fn((id: string, input: Partial<PolicyConfig>) => {
      const idx = policies.findIndex(p => p.id === id);
      if (idx === -1) return null;
      Object.assign(policies[idx], input);
      return policies[idx];
    }),
    delete: jest.fn((id: string) => {
      const idx = policies.findIndex(p => p.id === id);
      if (idx === -1) return false;
      policies.splice(idx, 1);
      return true;
    }),
    seedPreset: jest.fn((_presetId: string) => 3),
  };

  const policyGraph = {
    loadGraph: jest.fn(() => ({ nodes: [], edges: [], activations: [] })),
  };

  const policySets = {
    getParentChain: jest.fn(() => []),
    getMemberPolicyIds: jest.fn(() => []),
  };

  const secrets = {
    getAll: jest.fn(() => []),
    getByName: jest.fn(() => null),
  };

  const storage = {
    policies: policiesRepo,
    policyGraph,
    policySets,
    secrets,
    for: jest.fn(() => ({
      policies: policiesRepo,
      policyGraph,
      secrets,
    })),
  };

  return { storage: storage as any, policiesRepo, policyGraph, policies };
}

describe('PolicyManager', () => {
  describe('constructor', () => {
    it('creates without error', () => {
      const { storage } = createMockStorage();
      expect(() => new PolicyManager(storage)).not.toThrow();
    });

    it('has engineVersion >= 1', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      expect(manager.engineVersion).toBeGreaterThanOrEqual(1);
    });

    it('has a compiledEngine', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      expect(manager.compiledEngine).toBeDefined();
      expect(typeof manager.compiledEngine.evaluate).toBe('function');
    });
  });

  describe('evaluate', () => {
    it('denies by default when no policies match', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      const result = manager.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.allowed).toBe(false);
    });

    it('allows when matching allow policy exists', () => {
      const p = makePolicy({ id: 'allow-it', action: 'allow', target: 'url', patterns: ['example.com'] });
      const { storage } = createMockStorage([p]);
      const manager = new PolicyManager(storage);
      const result = manager.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.allowed).toBe(true);
      expect(result.policyId).toBe('allow-it');
    });

    it('denies when matching deny policy exists', () => {
      const p = makePolicy({ id: 'deny-it', action: 'deny', target: 'url', patterns: ['example.com'] });
      const { storage } = createMockStorage([p]);
      const manager = new PolicyManager(storage);
      const result = manager.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.allowed).toBe(false);
    });

    it('forwards context to engine', () => {
      const p = makePolicy({ id: 'agent-only', action: 'allow', target: 'url', patterns: ['example.com'], scope: 'agent' });
      const { storage } = createMockStorage([p]);
      const manager = new PolicyManager(storage);

      const result = manager.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
        context: { callerType: 'agent', depth: 0 },
      });
      expect(result.allowed).toBe(true);
      expect(result.executionContext?.callerType).toBe('agent');
    });

    it('respects defaultAction override', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      const result = manager.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
        defaultAction: 'allow',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('evaluateLive', () => {
    it('is equivalent to evaluate with resolveSecrets', () => {
      const p = makePolicy({ id: 'p1', action: 'allow', target: 'url', patterns: ['example.com'] });
      const { storage } = createMockStorage([p]);
      const manager = new PolicyManager(storage);

      const result = manager.evaluateLive({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.allowed).toBe(true);
    });

    it('handles graceful graph failure', () => {
      const p = makePolicy({ id: 'p1', action: 'allow', target: 'url', patterns: ['example.com'] });
      const { storage } = createMockStorage([p]);
      // Make graph load throw during live eval
      storage.for.mockReturnValue({
        policies: storage.policies,
        policyGraph: { loadGraph: () => { throw new Error('Graph unavailable'); } },
        secrets: storage.secrets,
      });
      const manager = new PolicyManager(storage);

      const result = manager.evaluateLive({
        operation: 'http_request',
        target: 'https://example.com',
      });
      // Should still return the compiled engine result
      expect(result.allowed).toBe(true);
    });
  });

  describe('CRUD recompile', () => {
    it('create bumps engine version', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      const v1 = manager.engineVersion;

      manager.create({ name: 'New', action: 'allow', target: 'url', patterns: ['new.com'] } as any);

      expect(manager.engineVersion).toBeGreaterThan(v1);
    });

    it('getById returns policy', () => {
      const p = makePolicy({ id: 'get-me' });
      const { storage } = createMockStorage([p]);
      const manager = new PolicyManager(storage);
      expect(manager.getById('get-me')).toEqual(p);
    });

    it('getAll returns all policies', () => {
      const p1 = makePolicy({ id: 'p1' });
      const p2 = makePolicy({ id: 'p2' });
      const { storage } = createMockStorage([p1, p2]);
      const manager = new PolicyManager(storage);
      expect(manager.getAll()).toHaveLength(2);
    });

    it('update bumps engine version', () => {
      const p = makePolicy({ id: 'update-me', action: 'allow', target: 'url', patterns: ['a.com'] });
      const { storage } = createMockStorage([p]);
      const manager = new PolicyManager(storage);
      const v1 = manager.engineVersion;

      manager.update('update-me', { patterns: ['b.com'] } as any);

      expect(manager.engineVersion).toBeGreaterThan(v1);
    });

    it('delete bumps engine version', () => {
      const p = makePolicy({ id: 'delete-me' });
      const { storage } = createMockStorage([p]);
      const manager = new PolicyManager(storage);
      const v1 = manager.engineVersion;

      manager.delete('delete-me');

      expect(manager.engineVersion).toBeGreaterThan(v1);
    });

    it('disabled policies are excluded from evaluation', () => {
      const p = makePolicy({ id: 'disabled', action: 'allow', target: 'url', patterns: ['example.com'], enabled: false });
      const { storage } = createMockStorage([p]);
      const manager = new PolicyManager(storage);
      const result = manager.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.policyId).toBeUndefined();
    });
  });

  describe('scoped access', () => {
    it('getEnabled returns only enabled policies', () => {
      const p1 = makePolicy({ id: 'on', enabled: true });
      const p2 = makePolicy({ id: 'off', enabled: false });
      const { storage } = createMockStorage([p1, p2]);
      const manager = new PolicyManager(storage);
      const enabled = manager.getEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe('on');
    });

    it('getAll with scope calls storage.for()', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      manager.getAll({ profileId: 'prof-1' });
      expect(storage.for).toHaveBeenCalledWith({ profileId: 'prof-1' });
    });
  });

  describe('seedPreset', () => {
    it('returns count and recompiles', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      const v1 = manager.engineVersion;

      const count = manager.seedPreset('openclaw');

      expect(count).toBe(3);
      expect(manager.engineVersion).toBeGreaterThan(v1);
    });

    it('does not recompile when count is 0', () => {
      const { storage } = createMockStorage();
      storage.policies.seedPreset.mockReturnValue(0);
      const manager = new PolicyManager(storage);
      const v1 = manager.engineVersion;

      manager.seedPreset('empty');

      expect(manager.engineVersion).toBe(v1);
    });
  });

  describe('syncSecrets', () => {
    it('is no-op without pushSecrets option', async () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);

      await expect(manager.syncSecrets([])).resolves.toBeUndefined();
    });

    it('calls pushSecrets when provided', async () => {
      const push = jest.fn();
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage, { pushSecrets: push });

      await manager.syncSecrets([]);

      expect(push).toHaveBeenCalledTimes(1);
    });
  });

  describe('hierarchy', () => {
    it('exposes hierarchy property', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      expect(manager.hierarchy).toBeDefined();
    });

    it('resolveEffectivePolicies is callable', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      const result = manager.hierarchy.resolveEffectivePolicies('any-set');
      expect(result.policies).toEqual([]);
    });
  });

  describe('graph error resilience', () => {
    it('constructs even when graph load fails', () => {
      const { storage } = createMockStorage();
      storage.policyGraph.loadGraph.mockImplementation(() => { throw new Error('no graph'); });
      expect(() => new PolicyManager(storage)).not.toThrow();
    });

    it('compiles without graph when graph fails', () => {
      const p = makePolicy({ id: 'p1', action: 'allow', target: 'url', patterns: ['example.com'] });
      const { storage } = createMockStorage([p]);
      storage.policyGraph.loadGraph.mockImplementation(() => { throw new Error('no graph'); });
      const manager = new PolicyManager(storage);
      const result = manager.evaluate({
        operation: 'http_request',
        target: 'https://example.com',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('recompile', () => {
    it('forces engine rebuild', () => {
      const { storage } = createMockStorage();
      const manager = new PolicyManager(storage);
      const v1 = manager.engineVersion;

      manager.recompile();

      expect(manager.engineVersion).toBeGreaterThan(v1);
    });
  });
});
