/**
 * Dormant policy activation — unit tests
 *
 * Ported from libs/shield-daemon/src/__tests__/graph-evaluator.spec.ts
 * (getActiveDormantPolicyIds section)
 */

import type { PolicyGraph } from '@agenshield/ipc';
import { getActiveDormantPolicyIds } from '../dormant';
import { makeNode, makeEdge, makeActivation } from '../../__tests__/helpers';

describe('getActiveDormantPolicyIds', () => {
  it('returns empty set when no dormant nodes', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1', false)],
      edges: [],
      activations: [],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.size).toBe(0);
  });

  it('returns empty set when dormant node has no incoming activate edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1', true)],
      edges: [],
      activations: [],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.size).toBe(0);
  });

  it('activates dormant node when incoming activate edge has active activation', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' })],
      activations: [makeActivation('act-1', 'e1')],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(true);
  });

  it('does not activate dormant node when activation is consumed', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' })],
      activations: [makeActivation('act-1', 'e1', { consumed: true })],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(false);
  });

  it('activates dormant node for persistent edges without activation', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'persistent' })],
      activations: [],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(true);
  });

  it('ignores disabled edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'persistent', enabled: false })],
      activations: [],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(false);
  });

  it('ignores non-activate edges', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'grant_network', lifetime: 'session' })],
      activations: [makeActivation('act-1', 'e1')],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(false);
  });

  it('excludes expired activations (TTL expiration)', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' })],
      activations: [makeActivation('act-1', 'e1', { expiresAt: pastDate })],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(false);
  });

  it('includes non-expired activations with future TTL', () => {
    const futureDate = new Date(Date.now() + 300_000).toISOString(); // 5 minutes from now
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' })],
      activations: [makeActivation('act-1', 'e1', { expiresAt: futureDate })],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(true);
  });

  it('includes activations without expiresAt (indefinite)', () => {
    const graph: PolicyGraph = {
      nodes: [makeNode('n1', 'p1'), makeNode('n2', 'p2', true)],
      edges: [makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' })],
      activations: [makeActivation('act-1', 'e1')], // no expiresAt
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p2')).toBe(true);
  });

  it('mixed: expired activation excluded, non-expired activation included', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const futureDate = new Date(Date.now() + 300_000).toISOString();
    const graph: PolicyGraph = {
      nodes: [
        makeNode('n1', 'p-root'),
        makeNode('n2', 'p-expired', true),
        makeNode('n3', 'p-active', true),
      ],
      edges: [
        makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' }),
        makeEdge('e2', 'n1', 'n3', { effect: 'activate', lifetime: 'session' }),
      ],
      activations: [
        makeActivation('act-1', 'e1', { expiresAt: pastDate }),
        makeActivation('act-2', 'e2', { expiresAt: futureDate }),
      ],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p-expired')).toBe(false);
    expect(result.has('p-active')).toBe(true);
  });

  it('handles multiple dormant nodes with mixed activation states', () => {
    const graph: PolicyGraph = {
      nodes: [
        makeNode('n1', 'p-root'),
        makeNode('n2', 'p-openai', true),
        makeNode('n3', 'p-jira', true),
        makeNode('n4', 'p-slack', true),
      ],
      edges: [
        makeEdge('e1', 'n1', 'n2', { effect: 'activate', lifetime: 'session' }),
        makeEdge('e2', 'n1', 'n3', { effect: 'activate', lifetime: 'session' }),
        makeEdge('e3', 'n1', 'n4', { effect: 'activate', lifetime: 'session' }),
      ],
      activations: [
        makeActivation('act-1', 'e1'), // openai activated
        // jira: no activation
        makeActivation('act-3', 'e3', { consumed: true }), // slack consumed
      ],
    };

    const result = getActiveDormantPolicyIds(graph);
    expect(result.has('p-openai')).toBe(true);
    expect(result.has('p-jira')).toBe(false);
    expect(result.has('p-slack')).toBe(false);
  });
});
