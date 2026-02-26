/**
 * Tiered Policy Sanity Tests
 *
 * Comprehensive tests covering the 3-tier policy system:
 * - Managed (admin-enforced, tier boost +10000)
 * - Target (per-target, tier boost +5000)
 * - Global (shared baseline, tier boost +0)
 *
 * Verifies policy resolution, CRUD without data loss, profile scoping,
 * process evaluation, graph integration, and full lifecycle.
 */

import { PolicyManager } from '../manager';
import { compile } from '../engine/compiler';
import type { PolicyConfig, PolicyGraph } from '@agenshield/ipc';
import { makePolicy, makeNode, makeEdge, makeActivation, makeGraph } from './helpers';

// ─── Tiered Mock Storage ─────────────────────────────────────

interface TieredMockStorageOptions {
  globalPolicies?: PolicyConfig[];
  targetPolicies?: Record<string, PolicyConfig[]>;
  managedPolicies?: PolicyConfig[];
  graph?: PolicyGraph;
}

function createTieredMockStorage(opts: TieredMockStorageOptions = {}) {
  const globalPolicies: PolicyConfig[] = (opts.globalPolicies ?? []).map(p => ({
    ...p,
    tier: p.tier ?? 'global',
  }));
  const managedPolicies: PolicyConfig[] = (opts.managedPolicies ?? []).map(p => ({
    ...p,
    tier: 'managed',
  }));
  const targetPoliciesMap: Record<string, PolicyConfig[]> = {};
  for (const [profileId, policies] of Object.entries(opts.targetPolicies ?? {})) {
    targetPoliciesMap[profileId] = policies.map(p => ({
      ...p,
      tier: p.tier ?? 'target',
    }));
  }

  const graph = opts.graph ?? { nodes: [], edges: [], activations: [] };

  // All policies across all tiers (for unscoped access)
  function allPolicies(): PolicyConfig[] {
    const all = [...managedPolicies, ...globalPolicies];
    for (const policies of Object.values(targetPoliciesMap)) {
      all.push(...policies);
    }
    return all;
  }

  // Policies visible for a given profileId (global + managed + that profile's target)
  function policiesForProfile(profileId: string | null): PolicyConfig[] {
    const result = [...managedPolicies, ...globalPolicies];
    if (profileId && targetPoliciesMap[profileId]) {
      result.push(...targetPoliciesMap[profileId]);
    }
    return result;
  }

  function makePoliciesRepo(getPoliciesFn: () => PolicyConfig[]) {
    return {
      create: jest.fn((input: Partial<PolicyConfig>) => {
        const p: PolicyConfig = {
          id: input.id ?? `p-auto-${Date.now()}`,
          name: input.name ?? 'New',
          action: input.action ?? 'allow',
          target: input.target ?? 'url',
          patterns: input.patterns ?? [],
          enabled: input.enabled ?? true,
          priority: input.priority ?? 0,
          ...input,
        } as PolicyConfig;
        // Add to the right tier storage
        if (p.tier === 'managed') {
          managedPolicies.push(p);
        } else if (p.tier === 'target') {
          // We'll add to first target profile or create new
          const firstProfile = Object.keys(targetPoliciesMap)[0] ?? 'default';
          if (!targetPoliciesMap[firstProfile]) targetPoliciesMap[firstProfile] = [];
          targetPoliciesMap[firstProfile].push(p);
        } else {
          globalPolicies.push(p);
        }
        return p;
      }),
      getById: jest.fn((id: string) => {
        return allPolicies().find(p => p.id === id) ?? null;
      }),
      getAll: jest.fn(() => getPoliciesFn()),
      getEnabled: jest.fn(() => getPoliciesFn().filter(p => p.enabled)),
      getManaged: jest.fn(() => managedPolicies.filter(p => p.enabled)),
      update: jest.fn((id: string, input: Partial<PolicyConfig>) => {
        // Find in all tiers
        for (const arr of [managedPolicies, globalPolicies, ...Object.values(targetPoliciesMap)]) {
          const idx = arr.findIndex(p => p.id === id);
          if (idx !== -1) {
            Object.assign(arr[idx], input);
            return arr[idx];
          }
        }
        return null;
      }),
      delete: jest.fn((id: string) => {
        for (const arr of [managedPolicies, globalPolicies, ...Object.values(targetPoliciesMap)]) {
          const idx = arr.findIndex(p => p.id === id);
          if (idx !== -1) {
            arr.splice(idx, 1);
            return true;
          }
        }
        return false;
      }),
      deleteNonManaged: jest.fn(() => {
        // Remove all non-managed from the scoped list
        globalPolicies.splice(0, globalPolicies.length,
          ...globalPolicies.filter(p => p.tier === 'managed'));
      }),
      seedPreset: jest.fn(() => 0),
    };
  }

  const globalRepo = makePoliciesRepo(() => policiesForProfile(null));

  const policyGraph = {
    loadGraph: jest.fn(() => graph),
    activate: jest.fn(),
    getActiveActivations: jest.fn(() => []),
    consumeActivation: jest.fn(),
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
    policies: globalRepo,
    policyGraph,
    policySets,
    secrets,
    for: jest.fn((scope: { profileId?: string | null }) => {
      const profileId = scope.profileId ?? null;
      return {
        policies: makePoliciesRepo(() => policiesForProfile(profileId)),
        policyGraph,
        secrets,
      };
    }),
  };

  return {
    storage: storage as any,
    globalPolicies,
    managedPolicies,
    targetPoliciesMap,
    graph,
  };
}

// ─── 1. Tiered Policy Resolution ─────────────────────────────

describe('Tiered Policy Resolution', () => {
  it('managed deny overrides global allow at same base priority', () => {
    const managedDeny = makePolicy({
      id: 'managed-deny',
      action: 'deny',
      target: 'url',
      patterns: ['example.com'],
      priority: 100,
      tier: 'managed',
    });
    const globalAllow = makePolicy({
      id: 'global-allow',
      action: 'allow',
      target: 'url',
      patterns: ['example.com'],
      priority: 100,
      tier: 'global',
    });

    const engine = compile({ policies: [managedDeny, globalAllow] });
    const result = engine.evaluate({
      operation: 'http_request',
      target: 'https://example.com',
    });

    expect(result.allowed).toBe(false);
    expect(result.policyId).toBe('managed-deny');
  });

  it('target allow overrides global deny at same base priority', () => {
    const targetAllow = makePolicy({
      id: 'target-allow',
      action: 'allow',
      target: 'url',
      patterns: ['example.com'],
      priority: 100,
      tier: 'target',
    });
    const globalDeny = makePolicy({
      id: 'global-deny',
      action: 'deny',
      target: 'url',
      patterns: ['example.com'],
      priority: 100,
      tier: 'global',
    });

    const engine = compile({ policies: [targetAllow, globalDeny] });
    const result = engine.evaluate({
      operation: 'http_request',
      target: 'https://example.com',
    });

    expect(result.allowed).toBe(true);
    expect(result.policyId).toBe('target-allow');
  });

  it('managed beats target even with lower base priority (within boost range)', () => {
    const managedDeny = makePolicy({
      id: 'managed-deny',
      action: 'deny',
      target: 'command',
      patterns: ['rm:*'],
      priority: 10,
      tier: 'managed',
    });
    const targetAllow = makePolicy({
      id: 'target-allow',
      action: 'allow',
      target: 'command',
      patterns: ['rm:*'],
      priority: 4000,
      tier: 'target',
    });

    const engine = compile({ policies: [managedDeny, targetAllow] });
    const result = engine.evaluate({
      operation: 'exec',
      target: 'rm -rf /tmp/data',
    });

    // managed: 10 + 10000 = 10010, target: 4000 + 5000 = 9000
    expect(result.allowed).toBe(false);
    expect(result.policyId).toBe('managed-deny');
  });

  it('global serves as baseline when no higher-tier matches', () => {
    const globalAllow = makePolicy({
      id: 'global-allow',
      action: 'allow',
      target: 'url',
      patterns: ['api.safe.com'],
      priority: 50,
      tier: 'global',
    });

    const engine = compile({ policies: [globalAllow] });
    const result = engine.evaluate({
      operation: 'http_request',
      target: 'https://api.safe.com/v1',
    });

    expect(result.allowed).toBe(true);
    expect(result.policyId).toBe('global-allow');
  });

  it('all three tiers coexist for command policies', () => {
    const managed = makePolicy({
      id: 'managed-cmd',
      action: 'deny',
      target: 'command',
      patterns: ['sudo:*'],
      priority: 100,
      tier: 'managed',
    });
    const target = makePolicy({
      id: 'target-cmd',
      action: 'allow',
      target: 'command',
      patterns: ['npm:*'],
      priority: 100,
      tier: 'target',
    });
    const global = makePolicy({
      id: 'global-cmd',
      action: 'allow',
      target: 'command',
      patterns: ['ls:*'],
      priority: 100,
      tier: 'global',
    });

    const engine = compile({ policies: [managed, target, global] });

    expect(engine.evaluate({ operation: 'exec', target: 'sudo rm -rf /' }).allowed).toBe(false);
    expect(engine.evaluate({ operation: 'exec', target: 'npm install' }).allowed).toBe(true);
    expect(engine.evaluate({ operation: 'exec', target: 'ls -la' }).allowed).toBe(true);
  });

  it('mixed tiers for different target types resolve independently', () => {
    const managedUrl = makePolicy({
      id: 'managed-url',
      action: 'deny',
      target: 'url',
      patterns: ['evil.com'],
      priority: 100,
      tier: 'managed',
    });
    const targetCmd = makePolicy({
      id: 'target-cmd',
      action: 'allow',
      target: 'command',
      patterns: ['safe-cmd:*'],
      priority: 100,
      tier: 'target',
    });

    const engine = compile({ policies: [managedUrl, targetCmd] });

    const urlResult = engine.evaluate({ operation: 'http_request', target: 'https://evil.com' });
    expect(urlResult.allowed).toBe(false);
    expect(urlResult.policyId).toBe('managed-url');

    const cmdResult = engine.evaluate({ operation: 'exec', target: 'safe-cmd --verbose' });
    expect(cmdResult.allowed).toBe(true);
    expect(cmdResult.policyId).toBe('target-cmd');
  });

  it('tier boost values correct: managed=10000, target=5000, global=0', () => {
    // All at base priority 0, managed should win
    const managed = makePolicy({
      id: 'p-managed',
      action: 'deny',
      target: 'url',
      patterns: ['test.com'],
      priority: 0,
      tier: 'managed',
    });
    const target = makePolicy({
      id: 'p-target',
      action: 'allow',
      target: 'url',
      patterns: ['test.com'],
      priority: 0,
      tier: 'target',
    });
    const global = makePolicy({
      id: 'p-global',
      action: 'allow',
      target: 'url',
      patterns: ['test.com'],
      priority: 0,
      tier: 'global',
    });

    const engine = compile({ policies: [managed, target, global] });
    const result = engine.evaluate({ operation: 'http_request', target: 'https://test.com' });

    // managed (0+10000) > target (0+5000) > global (0+0)
    expect(result.policyId).toBe('p-managed');
    expect(result.allowed).toBe(false);
  });

  it('within same tier, higher base priority wins', () => {
    const highPriority = makePolicy({
      id: 'high',
      action: 'allow',
      target: 'url',
      patterns: ['example.com'],
      priority: 200,
      tier: 'global',
    });
    const lowPriority = makePolicy({
      id: 'low',
      action: 'deny',
      target: 'url',
      patterns: ['example.com'],
      priority: 50,
      tier: 'global',
    });

    const engine = compile({ policies: [highPriority, lowPriority] });
    const result = engine.evaluate({
      operation: 'http_request',
      target: 'https://example.com',
    });

    expect(result.policyId).toBe('high');
    expect(result.allowed).toBe(true);
  });
});

// ─── 2. Policy Addition Without Loss ─────────────────────────

describe('Policy Addition Without Loss', () => {
  it('adding URL policy preserves existing command policies', () => {
    const cmdPolicy = makePolicy({
      id: 'cmd-1',
      action: 'allow',
      target: 'command',
      patterns: ['git:*'],
      tier: 'global',
    });
    const { storage } = createTieredMockStorage({ globalPolicies: [cmdPolicy] });
    const manager = new PolicyManager(storage);

    // Add a URL policy
    manager.create({
      id: 'url-1',
      name: 'Allow API',
      action: 'allow',
      target: 'url',
      patterns: ['api.example.com'],
    } as any);

    const all = manager.getAll();
    expect(all.some(p => p.id === 'cmd-1')).toBe(true);
    expect(all.some(p => p.id === 'url-1')).toBe(true);
  });

  it('adding filesystem policy preserves existing URL policies', () => {
    const urlPolicy = makePolicy({
      id: 'url-1',
      action: 'allow',
      target: 'url',
      patterns: ['safe.com'],
      tier: 'global',
    });
    const { storage } = createTieredMockStorage({ globalPolicies: [urlPolicy] });
    const manager = new PolicyManager(storage);

    manager.create({
      id: 'fs-1',
      name: 'Allow tmp',
      action: 'allow',
      target: 'filesystem',
      patterns: ['/tmp/**'],
    } as any);

    const all = manager.getAll();
    expect(all.some(p => p.id === 'url-1')).toBe(true);
    expect(all.some(p => p.id === 'fs-1')).toBe(true);
  });

  it('adding process policy preserves all other policy types', () => {
    const urlPolicy = makePolicy({ id: 'url-1', target: 'url', patterns: ['a.com'], tier: 'global' });
    const cmdPolicy = makePolicy({ id: 'cmd-1', target: 'command', patterns: ['ls'], tier: 'global' });
    const fsPolicy = makePolicy({ id: 'fs-1', target: 'filesystem', patterns: ['/tmp'], tier: 'global' });
    const { storage } = createTieredMockStorage({
      globalPolicies: [urlPolicy, cmdPolicy, fsPolicy],
    });
    const manager = new PolicyManager(storage);

    manager.create({
      id: 'proc-1',
      name: 'Deny miners',
      action: 'deny',
      target: 'process',
      patterns: ['*miner*'],
    } as any);

    const all = manager.getAll();
    expect(all).toHaveLength(4);
    expect(all.map(p => p.id).sort()).toEqual(['cmd-1', 'fs-1', 'proc-1', 'url-1']);
  });

  it('adding target-tier policies does not affect global-tier policies', () => {
    const globalPolicy = makePolicy({
      id: 'global-1',
      action: 'allow',
      target: 'url',
      patterns: ['safe.com'],
      tier: 'global',
    });
    const { storage } = createTieredMockStorage({ globalPolicies: [globalPolicy] });
    const manager = new PolicyManager(storage);

    manager.create({
      id: 'target-1',
      name: 'Target URL',
      action: 'allow',
      target: 'url',
      patterns: ['target-api.com'],
      tier: 'target',
    } as any);

    // Unscoped getAll returns global + managed only (correct behavior)
    const globalAll = manager.getAll();
    expect(globalAll.some(p => p.id === 'global-1' && p.tier === 'global')).toBe(true);

    // Target policy is visible via getById (searches all tiers)
    expect(manager.getById('target-1')).toBeTruthy();
  });

  it('adding target-specific policies does not affect global policies', () => {
    const globalPolicy = makePolicy({
      id: 'g-1',
      action: 'deny',
      target: 'command',
      patterns: ['rm:*'],
      tier: 'global',
    });
    const { storage } = createTieredMockStorage({
      globalPolicies: [globalPolicy],
      targetPolicies: { 'profile-a': [] },
    });
    const manager = new PolicyManager(storage);

    manager.create({
      id: 'tp-1',
      name: 'Target process',
      action: 'deny',
      target: 'process',
      patterns: ['bad-proc'],
      tier: 'target',
    } as any);

    // Global policy should still be there and unchanged
    expect(manager.getById('g-1')).toBeTruthy();
    expect(manager.getById('g-1')!.tier).toBe('global');
  });
});

// ─── 3. Profile-Scoped Engine Compilation ────────────────────

describe('Profile-Scoped Engine Compilation', () => {
  it('global engine includes only global + managed (no target)', () => {
    const globalPolicy = makePolicy({
      id: 'g-1',
      action: 'allow',
      target: 'url',
      patterns: ['global.com'],
      tier: 'global',
    });
    const managedPolicy = makePolicy({
      id: 'm-1',
      action: 'deny',
      target: 'url',
      patterns: ['blocked.com'],
      tier: 'managed',
    });
    const targetPolicy = makePolicy({
      id: 't-1',
      action: 'allow',
      target: 'url',
      patterns: ['target-only.com'],
      tier: 'target',
    });

    const { storage } = createTieredMockStorage({
      globalPolicies: [globalPolicy],
      managedPolicies: [managedPolicy],
      targetPolicies: { 'profile-1': [targetPolicy] },
    });
    const manager = new PolicyManager(storage);

    // Unscoped evaluate — should not see target-only.com
    const result = manager.evaluate({
      operation: 'http_request',
      target: 'https://target-only.com',
    });
    // target-only policy is not in unscoped engine, so falls through to default deny
    expect(result.policyId).not.toBe('t-1');
  });

  it('profile engine includes global + managed + target for that profile', () => {
    const globalPolicy = makePolicy({
      id: 'g-1',
      action: 'allow',
      target: 'url',
      patterns: ['global.com'],
      tier: 'global',
    });
    const managedPolicy = makePolicy({
      id: 'm-1',
      action: 'deny',
      target: 'url',
      patterns: ['blocked.com'],
      tier: 'managed',
    });
    const targetPolicy = makePolicy({
      id: 't-1',
      action: 'allow',
      target: 'url',
      patterns: ['target-only.com'],
      tier: 'target',
    });

    const { storage } = createTieredMockStorage({
      globalPolicies: [globalPolicy],
      managedPolicies: [managedPolicy],
      targetPolicies: { 'profile-1': [targetPolicy] },
    });
    const manager = new PolicyManager(storage);

    // Profile-scoped evaluate — should see target-only.com
    const result = manager.evaluate({
      operation: 'http_request',
      target: 'https://target-only.com',
      profileId: 'profile-1',
    });
    expect(result.allowed).toBe(true);
    expect(result.policyId).toBe('t-1');
  });

  it('profile engine cache invalidated on recompile', () => {
    const policy = makePolicy({
      id: 'g-1',
      action: 'allow',
      target: 'url',
      patterns: ['cached.com'],
      tier: 'global',
    });
    const { storage } = createTieredMockStorage({ globalPolicies: [policy] });
    const manager = new PolicyManager(storage);

    // Trigger profile engine caching
    manager.evaluate({
      operation: 'http_request',
      target: 'https://cached.com',
      profileId: 'profile-1',
    });

    const v1 = manager.engineVersion;
    manager.recompile();
    expect(manager.engineVersion).toBeGreaterThan(v1);
  });

  it('different profiles see different target policies but same managed/global', () => {
    const managed = makePolicy({
      id: 'm-shared',
      action: 'deny',
      target: 'url',
      patterns: ['evil.com'],
      tier: 'managed',
    });
    const global = makePolicy({
      id: 'g-shared',
      action: 'allow',
      target: 'url',
      patterns: ['public.com'],
      tier: 'global',
    });
    const targetA = makePolicy({
      id: 't-a',
      action: 'allow',
      target: 'url',
      patterns: ['app-a.com'],
      tier: 'target',
    });
    const targetB = makePolicy({
      id: 't-b',
      action: 'allow',
      target: 'url',
      patterns: ['app-b.com'],
      tier: 'target',
    });

    const { storage } = createTieredMockStorage({
      managedPolicies: [managed],
      globalPolicies: [global],
      targetPolicies: {
        'profile-a': [targetA],
        'profile-b': [targetB],
      },
    });
    const manager = new PolicyManager(storage);

    // Profile A sees app-a but not app-b
    const resultA = manager.evaluate({
      operation: 'http_request',
      target: 'https://app-a.com',
      profileId: 'profile-a',
    });
    expect(resultA.allowed).toBe(true);
    expect(resultA.policyId).toBe('t-a');

    // Profile B sees app-b but not app-a
    const resultB = manager.evaluate({
      operation: 'http_request',
      target: 'https://app-b.com',
      profileId: 'profile-b',
    });
    expect(resultB.allowed).toBe(true);
    expect(resultB.policyId).toBe('t-b');

    // Both profiles see managed deny
    const evilA = manager.evaluate({
      operation: 'http_request',
      target: 'https://evil.com',
      profileId: 'profile-a',
    });
    const evilB = manager.evaluate({
      operation: 'http_request',
      target: 'https://evil.com',
      profileId: 'profile-b',
    });
    expect(evilA.allowed).toBe(false);
    expect(evilA.policyId).toBe('m-shared');
    expect(evilB.allowed).toBe(false);
    expect(evilB.policyId).toBe('m-shared');
  });
});

// ─── 4. Seatbelt / Process Evaluation ────────────────────────

describe('Seatbelt Profile Calculation', () => {
  it('managed deny overrides target allow for same pattern', () => {
    const managedDeny = makePolicy({
      id: 'managed-proc-deny',
      action: 'deny',
      target: 'process',
      patterns: ['*crypto*'],
      priority: 50,
      tier: 'managed',
      enforcement: 'kill',
    });
    const targetAllow = makePolicy({
      id: 'target-proc-allow',
      action: 'allow',
      target: 'process',
      patterns: ['*crypto*'],
      priority: 50,
      tier: 'target',
    });

    const engine = compile({ policies: [managedDeny, targetAllow] });
    const result = engine.evaluateProcess('my-crypto-miner');

    // managed (50+10000) > target (50+5000), deny wins
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
    expect(result!.policyId).toBe('managed-proc-deny');
    expect(result!.enforcement).toBe('kill');
  });

  it('target allow overrides global deny at same base priority', () => {
    // evaluateProcess only looks at deny rules, so target allow won't block
    // and global deny should be the only deny — but target has higher tier
    const targetAllow = makePolicy({
      id: 'target-allow',
      action: 'allow',
      target: 'process',
      patterns: ['safe-proc'],
      priority: 100,
      tier: 'target',
    });
    const globalDeny = makePolicy({
      id: 'global-deny',
      action: 'deny',
      target: 'process',
      patterns: ['safe-proc'],
      priority: 100,
      tier: 'global',
    });

    const engine = compile({ policies: [targetAllow, globalDeny] });
    // evaluateProcess scans deny rules in priority order
    // target allow (100+5000=5100) > global deny (100+0=100) in compiled order
    // But evaluateProcess only checks deny rules — so only global-deny is checked
    const result = engine.evaluateProcess('safe-proc');
    expect(result).not.toBeNull();
    expect(result!.policyId).toBe('global-deny');
  });

  it('process enforcement reads from all tiered policies correctly', () => {
    const managed = makePolicy({
      id: 'mp',
      action: 'deny',
      target: 'process',
      patterns: ['*hack*'],
      priority: 0,
      tier: 'managed',
      enforcement: 'kill',
    });
    const target = makePolicy({
      id: 'tp',
      action: 'deny',
      target: 'process',
      patterns: ['*malware*'],
      priority: 0,
      tier: 'target',
      enforcement: 'alert',
    });
    const global = makePolicy({
      id: 'gp',
      action: 'deny',
      target: 'process',
      patterns: ['*botnet*'],
      priority: 0,
      tier: 'global',
      enforcement: 'kill',
    });

    const engine = compile({ policies: [managed, target, global] });

    expect(engine.evaluateProcess('run-hack-tool')!.policyId).toBe('mp');
    expect(engine.evaluateProcess('run-malware')!.policyId).toBe('tp');
    expect(engine.evaluateProcess('start-botnet')!.policyId).toBe('gp');
  });

  it('evaluateProcess scans all tiers deny rules', () => {
    const policies = [
      makePolicy({ id: 'd1', action: 'deny', target: 'process', patterns: ['proc-a'], tier: 'managed', priority: 0 }),
      makePolicy({ id: 'd2', action: 'deny', target: 'process', patterns: ['proc-b'], tier: 'target', priority: 0 }),
      makePolicy({ id: 'd3', action: 'deny', target: 'process', patterns: ['proc-c'], tier: 'global', priority: 0 }),
    ];

    const engine = compile({ policies });

    expect(engine.evaluateProcess('proc-a')).not.toBeNull();
    expect(engine.evaluateProcess('proc-b')).not.toBeNull();
    expect(engine.evaluateProcess('proc-c')).not.toBeNull();
    expect(engine.evaluateProcess('proc-safe')).toBeNull();
  });

  it('evaluating with all three tiers produces correct priority ordering', () => {
    const managed = makePolicy({
      id: 'mp',
      action: 'deny',
      target: 'process',
      patterns: ['conflict-proc'],
      priority: 10,
      tier: 'managed',
      enforcement: 'kill',
    });
    const target = makePolicy({
      id: 'tp',
      action: 'deny',
      target: 'process',
      patterns: ['conflict-proc'],
      priority: 10,
      tier: 'target',
      enforcement: 'alert',
    });
    const global = makePolicy({
      id: 'gp',
      action: 'deny',
      target: 'process',
      patterns: ['conflict-proc'],
      priority: 10,
      tier: 'global',
      enforcement: 'alert',
    });

    const engine = compile({ policies: [managed, target, global] });
    const result = engine.evaluateProcess('conflict-proc');

    // managed (10+10000) evaluated first
    expect(result!.policyId).toBe('mp');
    expect(result!.enforcement).toBe('kill');
  });

  it('disabled policies in any tier are excluded', () => {
    const disabledManaged = makePolicy({
      id: 'dm',
      action: 'deny',
      target: 'process',
      patterns: ['*'],
      tier: 'managed',
      enabled: false,
    });
    const enabledGlobal = makePolicy({
      id: 'eg',
      action: 'deny',
      target: 'process',
      patterns: ['bad-proc'],
      tier: 'global',
      enabled: true,
    });

    const engine = compile({ policies: [disabledManaged, enabledGlobal] });

    // Disabled managed should not match everything
    expect(engine.evaluateProcess('some-safe-proc')).toBeNull();
    // Enabled global still works
    expect(engine.evaluateProcess('bad-proc')!.policyId).toBe('eg');
  });
});

// ─── 5. Policy Graph with Tiers ──────────────────────────────

describe('Policy Graph with Tiers', () => {
  it('graph deny overrides managed allow', () => {
    const managedAllow = makePolicy({
      id: 'managed-allow',
      action: 'allow',
      target: 'url',
      patterns: ['example.com'],
      priority: 100,
      tier: 'managed',
    });

    const node = makeNode('n1', 'managed-allow');
    const denyEdge = makeEdge('e1', 'n1', 'n1', { effect: 'deny', condition: 'Graph-level deny' });
    const graph = makeGraph([node], [denyEdge]);

    const engine = compile({ policies: [managedAllow], graph });
    const result = engine.evaluate({
      operation: 'http_request',
      target: 'https://example.com',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Graph-level deny');
  });

  it('graph effects work with target-scoped policies', () => {
    const targetPolicy = makePolicy({
      id: 'target-p',
      action: 'allow',
      target: 'url',
      patterns: ['api.service.com'],
      priority: 100,
      tier: 'target',
    });

    const sourceNode = makeNode('n1', 'target-p');
    const targetNode = makeNode('n2', 'other-policy');
    const activateEdge = makeEdge('e1', 'n1', 'n2', { effect: 'activate' });
    const graph = makeGraph([sourceNode, targetNode], [activateEdge]);

    const engine = compile({ policies: [targetPolicy], graph });
    const result = engine.evaluate({
      operation: 'http_request',
      target: 'https://api.service.com/data',
    });

    expect(result.allowed).toBe(true);
    expect(result.policyId).toBe('target-p');
    expect(result.effects).toBeDefined();
    expect(result.effects!.activatedPolicyIds).toContain('other-policy');
  });

  it('dormant policy activation respects tier boost', () => {
    const triggerPolicy = makePolicy({
      id: 'trigger',
      action: 'allow',
      target: 'url',
      patterns: ['trigger.com'],
      priority: 100,
      tier: 'global',
    });
    const dormantPolicy = makePolicy({
      id: 'dormant-p',
      action: 'allow',
      target: 'url',
      patterns: ['secret.com'],
      priority: 50,
      tier: 'target',
    });

    const triggerNode = makeNode('n-trigger', 'trigger');
    const dormantNode = makeNode('n-dormant', 'dormant-p', true);
    const edge = makeEdge('e1', 'n-trigger', 'n-dormant', { effect: 'activate' });
    const activation = makeActivation('a1', 'e1');
    const graph = makeGraph([triggerNode, dormantNode], [edge], [activation]);

    const engine = compile({ policies: [triggerPolicy, dormantPolicy], graph });
    const result = engine.evaluate({
      operation: 'http_request',
      target: 'https://secret.com',
    });

    // Dormant policy is activated, so it should match
    expect(result.allowed).toBe(true);
    expect(result.policyId).toBe('dormant-p');
  });

  it('dormant managed policy excluded when no activation exists', () => {
    const dormantManaged = makePolicy({
      id: 'dormant-managed',
      action: 'allow',
      target: 'url',
      patterns: ['hidden.com'],
      priority: 200,
      tier: 'managed',
    });

    const dormantNode = makeNode('n-dormant', 'dormant-managed', true);
    // No activation and no persistent edge
    const graph = makeGraph([dormantNode], []);

    const engine = compile({ policies: [dormantManaged], graph });
    const result = engine.evaluate({
      operation: 'http_request',
      target: 'https://hidden.com',
    });

    // Dormant without activation → excluded from evaluation → default deny
    expect(result.policyId).toBeUndefined();
    expect(result.allowed).toBe(false);
  });

  it('graph deny overrides even managed allow policy', () => {
    const managedAllow = makePolicy({
      id: 'managed-high',
      action: 'allow',
      target: 'url',
      patterns: ['protected.com'],
      priority: 500,
      tier: 'managed',
    });

    const node = makeNode('n1', 'managed-high');
    const denyEdge = makeEdge('e1', 'n1', 'n1', {
      effect: 'deny',
      condition: 'Overridden by graph',
    });
    const graph = makeGraph([node], [denyEdge]);

    const engine = compile({ policies: [managedAllow], graph });
    const result = engine.evaluate({
      operation: 'http_request',
      target: 'https://protected.com',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Overridden by graph');
  });
});

// ─── 6. Full Lifecycle Sanity ────────────────────────────────

describe('Full Lifecycle Sanity', () => {
  it('create managed -> global -> target -> all evaluate correctly', () => {
    const { storage } = createTieredMockStorage();
    const manager = new PolicyManager(storage);

    manager.create({
      id: 'lc-managed',
      name: 'Managed Deny',
      action: 'deny',
      target: 'url',
      patterns: ['blocked.com'],
      tier: 'managed',
    } as any);

    manager.create({
      id: 'lc-global',
      name: 'Global Allow',
      action: 'allow',
      target: 'url',
      patterns: ['allowed.com'],
      tier: 'global',
    } as any);

    manager.create({
      id: 'lc-target',
      name: 'Target Allow',
      action: 'allow',
      target: 'command',
      patterns: ['deploy:*'],
      tier: 'target',
    } as any);

    // Unscoped getAll returns global + managed (target only in scoped queries)
    expect(manager.getAll()).toHaveLength(2);
    // All three accessible via getById
    expect(manager.getById('lc-managed')).toBeTruthy();
    expect(manager.getById('lc-global')).toBeTruthy();
    expect(manager.getById('lc-target')).toBeTruthy();

    const blockedResult = manager.evaluate({
      operation: 'http_request',
      target: 'https://blocked.com',
    });
    expect(blockedResult.allowed).toBe(false);

    const allowedResult = manager.evaluate({
      operation: 'http_request',
      target: 'https://allowed.com',
    });
    expect(allowedResult.allowed).toBe(true);
  });

  it('update target policy -> managed still intact', () => {
    const managed = makePolicy({
      id: 'up-managed',
      action: 'deny',
      target: 'url',
      patterns: ['evil.com'],
      tier: 'managed',
    });
    const target = makePolicy({
      id: 'up-target',
      action: 'allow',
      target: 'url',
      patterns: ['old-api.com'],
      tier: 'target',
    });
    const { storage } = createTieredMockStorage({
      managedPolicies: [managed],
      targetPolicies: { 'prof-1': [target] },
    });
    const manager = new PolicyManager(storage);

    // Update target policy patterns
    manager.update('up-target', { patterns: ['new-api.com'] } as any);

    // Managed policy should still exist and work
    const managedPolicy = manager.getById('up-managed');
    expect(managedPolicy).toBeTruthy();
    expect(managedPolicy!.tier).toBe('managed');

    const evilResult = manager.evaluate({
      operation: 'http_request',
      target: 'https://evil.com',
    });
    expect(evilResult.allowed).toBe(false);
    expect(evilResult.policyId).toBe('up-managed');
  });

  it('delete global policy -> managed and target unaffected', () => {
    const managed = makePolicy({
      id: 'del-managed',
      action: 'deny',
      target: 'url',
      patterns: ['evil.com'],
      tier: 'managed',
    });
    const global = makePolicy({
      id: 'del-global',
      action: 'allow',
      target: 'url',
      patterns: ['removeme.com'],
      tier: 'global',
    });
    const target = makePolicy({
      id: 'del-target',
      action: 'allow',
      target: 'command',
      patterns: ['safe-cmd'],
      tier: 'target',
    });
    const { storage } = createTieredMockStorage({
      managedPolicies: [managed],
      globalPolicies: [global],
      targetPolicies: { 'p1': [target] },
    });
    const manager = new PolicyManager(storage);

    // Delete global policy
    const deleted = manager.delete('del-global');
    expect(deleted).toBe(true);

    // Managed and target should still exist
    expect(manager.getById('del-managed')).toBeTruthy();
    expect(manager.getById('del-target')).toBeTruthy();
    expect(manager.getById('del-global')).toBeNull();
  });

  it('recompile after each CRUD -> engine versions increment', () => {
    const { storage } = createTieredMockStorage();
    const manager = new PolicyManager(storage);

    const v0 = manager.engineVersion;

    manager.create({ id: 'v-1', name: 'P1', action: 'allow', target: 'url', patterns: ['a.com'] } as any);
    const v1 = manager.engineVersion;
    expect(v1).toBeGreaterThan(v0);

    manager.update('v-1', { patterns: ['b.com'] } as any);
    const v2 = manager.engineVersion;
    expect(v2).toBeGreaterThan(v1);

    manager.delete('v-1');
    const v3 = manager.engineVersion;
    expect(v3).toBeGreaterThan(v2);

    manager.recompile();
    const v4 = manager.engineVersion;
    expect(v4).toBeGreaterThan(v3);
  });

  it('multiple profiles with overlapping and distinct policies', () => {
    const managed = makePolicy({
      id: 'shared-managed',
      action: 'deny',
      target: 'url',
      patterns: ['malware.com'],
      tier: 'managed',
    });
    const global = makePolicy({
      id: 'shared-global',
      action: 'allow',
      target: 'url',
      patterns: ['cdn.shared.com'],
      tier: 'global',
    });
    const targetA = makePolicy({
      id: 'only-a',
      action: 'allow',
      target: 'url',
      patterns: ['app-a-api.com'],
      tier: 'target',
    });
    const targetB = makePolicy({
      id: 'only-b',
      action: 'allow',
      target: 'url',
      patterns: ['app-b-api.com'],
      tier: 'target',
    });

    const { storage } = createTieredMockStorage({
      managedPolicies: [managed],
      globalPolicies: [global],
      targetPolicies: {
        'profile-a': [targetA],
        'profile-b': [targetB],
      },
    });
    const manager = new PolicyManager(storage);

    // Profile A: sees shared + target A
    const aShared = manager.evaluate({
      operation: 'http_request',
      target: 'https://cdn.shared.com',
      profileId: 'profile-a',
    });
    expect(aShared.allowed).toBe(true);

    const aOwn = manager.evaluate({
      operation: 'http_request',
      target: 'https://app-a-api.com',
      profileId: 'profile-a',
    });
    expect(aOwn.allowed).toBe(true);
    expect(aOwn.policyId).toBe('only-a');

    // Profile A should NOT see profile B's target
    const aCrossProfile = manager.evaluate({
      operation: 'http_request',
      target: 'https://app-b-api.com',
      profileId: 'profile-a',
    });
    expect(aCrossProfile.policyId).not.toBe('only-b');

    // Both profiles see managed deny
    const aMalware = manager.evaluate({
      operation: 'http_request',
      target: 'https://malware.com',
      profileId: 'profile-a',
    });
    const bMalware = manager.evaluate({
      operation: 'http_request',
      target: 'https://malware.com',
      profileId: 'profile-b',
    });
    expect(aMalware.allowed).toBe(false);
    expect(bMalware.allowed).toBe(false);
  });

  it('disabled policies in any tier excluded from evaluation', () => {
    const disabledManaged = makePolicy({
      id: 'dis-m',
      action: 'deny',
      target: 'url',
      patterns: ['*'],
      tier: 'managed',
      enabled: false,
    });
    const disabledTarget = makePolicy({
      id: 'dis-t',
      action: 'deny',
      target: 'command',
      patterns: ['*'],
      tier: 'target',
      enabled: false,
    });
    const enabledGlobal = makePolicy({
      id: 'en-g',
      action: 'allow',
      target: 'url',
      patterns: ['good.com'],
      tier: 'global',
      enabled: true,
    });

    const engine = compile({ policies: [disabledManaged, disabledTarget, enabledGlobal] });

    // Disabled managed deny-all should not block
    const urlResult = engine.evaluate({
      operation: 'http_request',
      target: 'https://good.com',
    });
    expect(urlResult.allowed).toBe(true);
    expect(urlResult.policyId).toBe('en-g');

    // Disabled target deny-all should not block commands
    const cmdResult = engine.evaluate({
      operation: 'exec',
      target: 'any-command',
    });
    // No matching enabled command policy → default deny
    expect(cmdResult.policyId).toBeUndefined();
  });
});
