/**
 * Policy Engine Compiler
 *
 * Builds a CompiledPolicyEngine from policies + graph + hierarchy.
 * Called on every policy change (CRUD, graph edit, etc.)
 *
 * The compiled engine contains pre-processed data structures optimized
 * for fast lookup — no DB hit during evaluate().
 */

import type { PolicyConfig, PolicyGraph } from '@agenshield/ipc';
import { matchUrlPattern, normalizeUrlTarget } from '../matcher/url';
import { matchCommandPattern } from '../matcher/command';
import { matchFilesystemPattern } from '../matcher/filesystem';
import { matchProcessPattern } from '../matcher/process';
import { policyScopeMatches } from '../matcher/scope';
import { getActiveDormantPolicyIds } from '../graph/dormant';
import type { CompiledRule, PrecomputedEffects } from './types';
import { CompiledPolicyEngine } from './compiled';

let versionCounter = 0;

export interface CompileInput {
  policies: PolicyConfig[];
  graph?: PolicyGraph;
  defaultAction?: 'allow' | 'deny';
}

/**
 * Map interceptor operations to policy target types.
 */
export function operationToTarget(operation: string): string {
  switch (operation) {
    case 'http_request':
    case 'open_url':
      return 'url';
    case 'exec':
      return 'command';
    case 'file_read':
    case 'file_write':
    case 'file_list':
      return 'filesystem';
    case 'process_run':
      return 'process';
    default:
      return operation;
  }
}

/**
 * Build pattern matchers for a policy based on its target type.
 */
function buildMatchers(policy: PolicyConfig): Array<(target: string) => boolean> {
  return policy.patterns.map(pattern => {
    if (policy.target === 'url') {
      return (target: string) => matchUrlPattern(pattern, normalizeUrlTarget(target));
    } else if (policy.target === 'command') {
      return (target: string) => matchCommandPattern(pattern, target);
    } else if (policy.target === 'process') {
      return (target: string) => matchProcessPattern(pattern, target);
    } else {
      // filesystem
      return (target: string) => matchFilesystemPattern(pattern, target);
    }
  });
}

/**
 * Pre-compute graph effects for each policy node.
 * Stores secret names (not values) — values resolved at eval time.
 */
function precomputeGraphEffects(
  graph: PolicyGraph,
): Map<string, PrecomputedEffects> {
  const map = new Map<string, PrecomputedEffects>();

  for (const node of graph.nodes) {
    const outgoing = graph.edges
      .filter(e => e.sourceNodeId === node.id && e.enabled)
      .sort((a, b) => b.priority - a.priority);

    if (outgoing.length === 0) continue;

    const effects: PrecomputedEffects = {
      grantedNetworkPatterns: [],
      grantedFsPaths: { read: [], write: [] },
      secretNames: [],
      activatesPolicyIds: [],
      denied: false,
    };

    for (const edge of outgoing) {
      switch (edge.effect) {
        case 'grant_network':
          if (edge.grantPatterns) effects.grantedNetworkPatterns.push(...edge.grantPatterns);
          break;
        case 'grant_fs':
          if (edge.grantPatterns) {
            for (const p of edge.grantPatterns) {
              if (p.startsWith('w:')) effects.grantedFsPaths.write.push(p.slice(2));
              else if (p.startsWith('r:')) effects.grantedFsPaths.read.push(p.slice(2));
              else effects.grantedFsPaths.read.push(p);
            }
          }
          break;
        case 'inject_secret':
          if (edge.secretName) effects.secretNames.push(edge.secretName);
          break;
        case 'activate': {
          const targetNode = graph.nodes.find(n => n.id === edge.targetNodeId);
          if (targetNode) effects.activatesPolicyIds.push(targetNode.policyId);
          break;
        }
        case 'deny':
          effects.denied = true;
          effects.denyReason = edge.condition || 'Denied by graph edge';
          break;
      }
    }

    map.set(node.policyId, effects);
  }

  return map;
}

/**
 * Compile policies + graph into a fast in-memory engine.
 */
export function compile(input: CompileInput): CompiledPolicyEngine {
  const { policies, graph, defaultAction = 'deny' } = input;

  // Determine active dormant policy IDs from graph
  const activeDormantIds = graph ? getActiveDormantPolicyIds(graph) : new Set<string>();

  // Filter: enabled, scope-applicable, and dormant-resolved
  const applicable = policies.filter(p => {
    if (!p.enabled) return false;
    if (!graph) return true;
    const node = graph.nodes.find(n => n.policyId === p.id);
    if (!node) return true; // Not in graph → always included
    if (!node.dormant) return true; // Non-dormant → always included
    return activeDormantIds.has(p.id); // Dormant → only if activated
  });

  // Build compiled rules grouped by target type
  const commandRules: CompiledRule[] = [];
  const urlRules: CompiledRule[] = [];
  const filesystemRules: CompiledRule[] = [];
  const processRules: CompiledRule[] = [];

  for (const policy of applicable) {
    // Tier-based priority boost: Managed > Target > Global
    const tierBoost = policy.tier === 'managed' ? 10000
                    : policy.tier === 'target' ? 5000
                    : 0;

    const rule: CompiledRule = {
      policyId: policy.id,
      policyName: policy.name,
      action: policy.action,
      priority: (policy.priority ?? 0) + tierBoost,
      matchers: buildMatchers(policy),
      scopeMatch: (ctx) => policyScopeMatches(policy, ctx),
      operations: policy.operations && policy.operations.length > 0
        ? new Set(policy.operations)
        : null,
      methods: policy.methods && policy.methods.length > 0
        ? new Set(policy.methods)
        : null,
      enforcement: policy.enforcement,
    };

    switch (policy.target) {
      case 'command':
        commandRules.push(rule);
        break;
      case 'url':
        urlRules.push(rule);
        break;
      case 'filesystem':
        filesystemRules.push(rule);
        break;
      case 'process':
        processRules.push(rule);
        break;
    }
  }

  // Sort each group by priority DESC
  const sortByPriority = (a: CompiledRule, b: CompiledRule) => b.priority - a.priority;
  commandRules.sort(sortByPriority);
  urlRules.sort(sortByPriority);
  filesystemRules.sort(sortByPriority);
  processRules.sort(sortByPriority);

  // Pre-compute graph effects
  const graphEffectsMap = graph ? precomputeGraphEffects(graph) : new Map();

  versionCounter++;

  return new CompiledPolicyEngine({
    commandRules,
    urlRules,
    filesystemRules,
    processRules,
    graphEffectsMap,
    activeDormantIds,
    defaultAction,
    version: versionCounter,
    compiledAt: Date.now(),
  });
}
