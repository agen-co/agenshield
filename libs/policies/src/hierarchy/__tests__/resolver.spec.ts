/**
 * HierarchyResolver — unit tests
 */

import { HierarchyResolver } from '../resolver';
import { makePolicy } from '../../__tests__/helpers';
import type { PolicyConfig } from '@agenshield/ipc';

function mockPolicySets(sets: Array<{ id: string; name: string; enforced: boolean; parentId?: string | null }>) {
  const setMap = new Map(sets.map(s => [s.id, s]));

  return {
    getParentChain: jest.fn((leafId: string) => {
      const chain: typeof sets = [];
      let current = setMap.get(leafId);
      while (current) {
        chain.push(current);
        current = current.parentId ? setMap.get(current.parentId) : undefined;
      }
      return chain;
    }),
    getMemberPolicyIds: jest.fn((_setId: string) => [] as string[]),
  };
}

function mockPolicyRepo(policies: PolicyConfig[]) {
  const policyMap = new Map(policies.map(p => [p.id, p]));
  return {
    getById: jest.fn((id: string) => policyMap.get(id) ?? null),
  };
}

describe('HierarchyResolver', () => {
  describe('empty chain', () => {
    it('returns empty policies for unknown set', () => {
      const policySets = mockPolicySets([]);
      const policyRepo = mockPolicyRepo([]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);

      const result = resolver.resolveEffectivePolicies('unknown-set');

      expect(result.policies).toEqual([]);
      expect(result.chain).toEqual([]);
    });

    it('returns empty chain array', () => {
      const policySets = mockPolicySets([]);
      const policyRepo = mockPolicyRepo([]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);

      const result = resolver.resolveEffectivePolicies('unknown');

      expect(result.chain).toHaveLength(0);
    });
  });

  describe('single set', () => {
    it('returns policies for a single set', () => {
      const p1 = makePolicy({ id: 'p1', action: 'allow', patterns: ['example.com'] });
      const p2 = makePolicy({ id: 'p2', action: 'deny', patterns: ['evil.com'] });

      const policySets = mockPolicySets([
        { id: 'set1', name: 'Team Set', enforced: false },
      ]);
      policySets.getMemberPolicyIds.mockReturnValue(['p1', 'p2']);

      const policyRepo = mockPolicyRepo([p1, p2]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);

      const result = resolver.resolveEffectivePolicies('set1');

      expect(result.policies).toHaveLength(2);
    });

    it('sorts by priority DESC', () => {
      const p1 = makePolicy({ id: 'p1', priority: 10 });
      const p2 = makePolicy({ id: 'p2', priority: 100 });

      const policySets = mockPolicySets([
        { id: 'set1', name: 'Set', enforced: false },
      ]);
      policySets.getMemberPolicyIds.mockReturnValue(['p1', 'p2']);

      const policyRepo = mockPolicyRepo([p1, p2]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);

      const result = resolver.resolveEffectivePolicies('set1');

      expect(result.policies[0].id).toBe('p2');
      expect(result.policies[1].id).toBe('p1');
    });

    it('chain has one node', () => {
      const policySets = mockPolicySets([
        { id: 'set1', name: 'Only Set', enforced: false },
      ]);
      policySets.getMemberPolicyIds.mockReturnValue([]);

      const policyRepo = mockPolicyRepo([]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);

      const result = resolver.resolveEffectivePolicies('set1');

      expect(result.chain).toHaveLength(1);
      expect(result.chain[0].policySetId).toBe('set1');
    });
  });

  describe('parent chain merge', () => {
    const rootPolicy = makePolicy({ id: 'root-p', priority: 50, patterns: ['root.com'] });
    const childPolicy = makePolicy({ id: 'child-p', priority: 60, patterns: ['child.com'] });
    const overridePolicy = makePolicy({ id: 'root-p', priority: 80, patterns: ['override.com'] });

    it('child overrides non-enforced parent policy with same id', () => {
      const policySets = mockPolicySets([
        { id: 'child', name: 'Child', enforced: false, parentId: 'root' },
        { id: 'root', name: 'Root', enforced: false },
      ]);
      policySets.getMemberPolicyIds.mockImplementation((setId: string) => {
        if (setId === 'root') return ['root-p'];
        if (setId === 'child') return ['root-p'];
        return [];
      });

      const policyRepo = mockPolicyRepo([rootPolicy, overridePolicy]);
      // Override: child returns overridePolicy, root returns rootPolicy
      policyRepo.getById.mockImplementation((id: string) => {
        // Both sets reference 'root-p', but the child's version wins
        return id === 'root-p' ? overridePolicy : null;
      });

      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);
      const result = resolver.resolveEffectivePolicies('child');

      // The child version should win since parent is NOT enforced
      expect(result.policies.find(p => p.id === 'root-p')!.patterns).toEqual(['override.com']);
    });

    it('enforced parent policies cannot be overridden', () => {
      const policySets = mockPolicySets([
        { id: 'child', name: 'Child', enforced: false, parentId: 'root' },
        { id: 'root', name: 'Root', enforced: true },
      ]);
      policySets.getMemberPolicyIds.mockImplementation((setId: string) => {
        if (setId === 'root') return ['root-p'];
        if (setId === 'child') return ['root-p'];
        return [];
      });

      const policyRepo = mockPolicyRepo([rootPolicy]);

      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);
      const result = resolver.resolveEffectivePolicies('child');

      // Root's enforced version should win
      expect(result.policies.find(p => p.id === 'root-p')!.priority).toBe(50);
    });

    it('root policies are included', () => {
      const policySets = mockPolicySets([
        { id: 'child', name: 'Child', enforced: false, parentId: 'root' },
        { id: 'root', name: 'Root', enforced: false },
      ]);
      policySets.getMemberPolicyIds.mockImplementation((setId: string) => {
        if (setId === 'root') return ['root-p'];
        if (setId === 'child') return ['child-p'];
        return [];
      });

      const policyRepo = mockPolicyRepo([rootPolicy, childPolicy]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);
      const result = resolver.resolveEffectivePolicies('child');

      expect(result.policies.map(p => p.id)).toContain('root-p');
      expect(result.policies.map(p => p.id)).toContain('child-p');
    });

    it('chain is in leaf-to-root order', () => {
      const policySets = mockPolicySets([
        { id: 'child', name: 'Child', enforced: false, parentId: 'root' },
        { id: 'root', name: 'Root', enforced: false },
      ]);
      policySets.getMemberPolicyIds.mockReturnValue([]);

      const policyRepo = mockPolicyRepo([]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);
      const result = resolver.resolveEffectivePolicies('child');

      expect(result.chain[0].policySetId).toBe('child');
      expect(result.chain[1].policySetId).toBe('root');
    });
  });

  describe('enforced flag', () => {
    it('enforced policies are locked', () => {
      const p1 = makePolicy({ id: 'locked-p', priority: 10, patterns: ['locked.com'] });

      const policySets = mockPolicySets([
        { id: 'child', name: 'Child', enforced: false, parentId: 'root' },
        { id: 'root', name: 'Root', enforced: true },
      ]);
      policySets.getMemberPolicyIds.mockImplementation((setId: string) => {
        if (setId === 'root') return ['locked-p'];
        return [];
      });

      const policyRepo = mockPolicyRepo([p1]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);
      const result = resolver.resolveEffectivePolicies('child');

      expect(result.policies).toHaveLength(1);
      expect(result.policies[0].id).toBe('locked-p');
    });

    it('non-enforced parent allows child override', () => {
      const parentP = makePolicy({ id: 'shared-p', priority: 10, patterns: ['parent.com'] });
      const childP = makePolicy({ id: 'shared-p', priority: 20, patterns: ['child.com'] });

      const policySets = mockPolicySets([
        { id: 'child', name: 'Child', enforced: false, parentId: 'root' },
        { id: 'root', name: 'Root', enforced: false },
      ]);
      policySets.getMemberPolicyIds.mockImplementation((setId: string) => {
        return setId === 'root' || setId === 'child' ? ['shared-p'] : [];
      });

      const policyRepo = mockPolicyRepo([childP]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);
      const result = resolver.resolveEffectivePolicies('child');

      expect(result.policies[0].patterns).toEqual(['child.com']);
    });
  });

  describe('priority sort', () => {
    it('final result is sorted by priority DESC', () => {
      const p1 = makePolicy({ id: 'p1', priority: 5 });
      const p2 = makePolicy({ id: 'p2', priority: 50 });
      const p3 = makePolicy({ id: 'p3', priority: 25 });

      const policySets = mockPolicySets([
        { id: 'set1', name: 'Set', enforced: false },
      ]);
      policySets.getMemberPolicyIds.mockReturnValue(['p1', 'p2', 'p3']);

      const policyRepo = mockPolicyRepo([p1, p2, p3]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);
      const result = resolver.resolveEffectivePolicies('set1');

      expect(result.policies.map(p => p.id)).toEqual(['p2', 'p3', 'p1']);
    });

    it('treats null/undefined priority as 0', () => {
      const p1 = makePolicy({ id: 'p1', priority: undefined });
      const p2 = makePolicy({ id: 'p2', priority: 1 });

      const policySets = mockPolicySets([
        { id: 'set1', name: 'Set', enforced: false },
      ]);
      policySets.getMemberPolicyIds.mockReturnValue(['p1', 'p2']);

      const policyRepo = mockPolicyRepo([p1, p2]);
      const resolver = new HierarchyResolver(policySets as any, policyRepo as any);
      const result = resolver.resolveEffectivePolicies('set1');

      expect(result.policies[0].id).toBe('p2');
    });
  });
});
