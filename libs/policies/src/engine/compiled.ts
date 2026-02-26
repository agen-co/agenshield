/**
 * CompiledPolicyEngine — Fast in-memory policy evaluation.
 *
 * No DB access during evaluate(). All data is pre-compiled.
 * Secrets are NOT baked in — they're resolved lazily from the vault
 * when graph effects require inject_secret.
 */

import type { PolicyExecutionContext } from '@agenshield/ipc';
import type { GraphEffects } from '../graph/effects';
import { emptyEffects } from '../graph/effects';
import { normalizeUrlTarget } from '../matcher/url';
import { operationToTarget } from './compiler';
import type { CompiledRule, PrecomputedEffects, EvaluationInput, EvaluationResult, ProcessEvaluationResult } from './types';

export interface CompiledEngineData {
  commandRules: CompiledRule[];
  urlRules: CompiledRule[];
  filesystemRules: CompiledRule[];
  processRules: CompiledRule[];
  graphEffectsMap: Map<string, PrecomputedEffects>;
  activeDormantIds: Set<string>;
  defaultAction: 'allow' | 'deny';
  version: number;
  compiledAt: number;
}

export class CompiledPolicyEngine {
  readonly version: number;
  readonly compiledAt: number;
  private readonly data: CompiledEngineData;

  constructor(data: CompiledEngineData) {
    this.data = data;
    this.version = data.version;
    this.compiledAt = data.compiledAt;
  }

  /**
   * Evaluate a policy check against the compiled rules.
   *
   * - O(n) pattern scan over pre-compiled rules (sorted by priority)
   * - No DB hit (except lazy secret resolution when graph effects need it)
   * - Returns GraphEffects for sandbox builder to consume
   */
  evaluate(input: EvaluationInput): EvaluationResult {
    const { operation, target, context, defaultAction } = input;
    const targetType = operationToTarget(operation);
    const effectiveDefault = defaultAction ?? this.data.defaultAction;

    // Select rules by target type
    const rules = this.getRulesForTarget(targetType);

    // Block plain HTTP by default
    if (targetType === 'url' && target.match(/^http:\/\//i)) {
      const httpResult = this.checkPlainHttp(rules, target, context);
      if (httpResult) return httpResult;
    }

    // Normalize target for URL matching
    const effectiveTarget = targetType === 'url' ? normalizeUrlTarget(target) : target;

    // Scan rules in priority order
    for (const rule of rules) {
      // Check scope match
      if (!rule.scopeMatch(context)) continue;

      // Check operations filter
      if (rule.operations && !rule.operations.has(operation)) continue;

      // Check pattern match
      for (const matcher of rule.matchers) {
        if (matcher(effectiveTarget)) {
          const allowed = rule.action === 'allow';

          // Look up pre-computed graph effects
          const precomputed = this.data.graphEffectsMap.get(rule.policyId);
          let effects: GraphEffects | undefined;

          if (precomputed) {
            // Graph deny overrides allow
            if (precomputed.denied) {
              return {
                allowed: false,
                policyId: rule.policyId,
                reason: precomputed.denyReason || 'Denied by policy graph edge',
                executionContext: context,
              };
            }

            effects = this.buildGraphEffects(precomputed);
          }

          return {
            allowed,
            policyId: rule.policyId,
            reason: allowed
              ? `Allowed by policy: ${rule.policyId}`
              : `Denied by policy: ${rule.policyId}`,
            effects,
            executionContext: context,
          };
        }
      }
    }

    // No matching policy — use default action
    return {
      allowed: effectiveDefault === 'allow',
      reason: effectiveDefault === 'deny' ? 'No matching allow policy' : undefined,
      executionContext: context,
    };
  }

  /**
   * Get the set of active dormant policy IDs.
   */
  get activeDormantPolicyIds(): Set<string> {
    return this.data.activeDormantIds;
  }

  /**
   * Evaluate a running process against process-target policies.
   *
   * Returns null if no deny rule matches (process is allowed).
   * Returns ProcessEvaluationResult if a deny rule matches.
   */
  evaluateProcess(command: string, context?: PolicyExecutionContext): ProcessEvaluationResult | null {
    const rules = this.data.processRules;

    for (const rule of rules) {
      // Only deny rules trigger enforcement
      if (rule.action !== 'deny') continue;

      // Check scope match
      if (!rule.scopeMatch(context)) continue;

      // Check pattern match
      for (const matcher of rule.matchers) {
        if (matcher(command)) {
          return {
            allowed: false,
            policyId: rule.policyId,
            policyName: rule.policyName,
            reason: `Process denied by policy: ${rule.policyId}`,
            enforcement: rule.enforcement ?? 'alert',
          };
        }
      }
    }

    return null;
  }

  private getRulesForTarget(targetType: string): CompiledRule[] {
    switch (targetType) {
      case 'command': return this.data.commandRules;
      case 'url': return this.data.urlRules;
      case 'filesystem': return this.data.filesystemRules;
      case 'process': return this.data.processRules;
      default: return [];
    }
  }

  /**
   * Block plain HTTP requests unless explicitly allowed.
   */
  private checkPlainHttp(
    rules: CompiledRule[],
    target: string,
    context?: PolicyExecutionContext,
  ): EvaluationResult | null {
    const effectiveTarget = normalizeUrlTarget(target);
    let explicitHttpAllow = false;

    for (const rule of rules) {
      if (rule.action !== 'allow') continue;
      if (!rule.scopeMatch(context)) continue;

      for (const matcher of rule.matchers) {
        // We need to check if the pattern explicitly allows http://
        // The matcher already handles this via matchUrlPattern
        if (matcher(effectiveTarget)) {
          explicitHttpAllow = true;
          break;
        }
      }
      if (explicitHttpAllow) break;
    }

    if (!explicitHttpAllow) {
      return {
        allowed: false,
        reason: 'Plain HTTP is blocked by default. Use HTTPS or create an explicit http:// allow policy.',
        executionContext: context,
      };
    }

    return null;
  }

  /**
   * Build GraphEffects from pre-computed effects.
   * Note: injectedSecrets is empty here — secrets are resolved lazily
   * by the caller (daemon) since vault state can change independently.
   */
  private buildGraphEffects(precomputed: PrecomputedEffects): GraphEffects {
    const effects = emptyEffects();

    effects.grantedNetworkPatterns = [...precomputed.grantedNetworkPatterns];
    effects.grantedFsPaths = {
      read: [...precomputed.grantedFsPaths.read],
      write: [...precomputed.grantedFsPaths.write],
    };
    effects.activatedPolicyIds = [...precomputed.activatesPolicyIds];
    effects.denied = precomputed.denied;
    effects.denyReason = precomputed.denyReason;

    // Secrets NOT resolved here — caller must resolve from vault
    // precomputed.secretNames is available for callers that need it

    return effects;
  }
}
