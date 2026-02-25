/**
 * PolicyManager — Main entry point for @agenshield/policies
 *
 * Wraps storage repositories with a compiled engine for fast evaluation.
 * Serves as the single authority for policy CRUD, evaluation, graph management,
 * and secret binding.
 */

import type { PolicyConfig, PolicyGraph, ScopeFilter } from '@agenshield/ipc';
import type { Storage, ScopedStorage } from '@agenshield/storage';
import type { EventBus } from '@agenshield/ipc';
import { compile } from './engine/compiler';
import type { CompiledPolicyEngine } from './engine/compiled';
import type { EvaluationInput, EvaluationResult } from './engine/types';
import { HierarchyResolver } from './hierarchy/resolver';
import { evaluateGraphEffects, emptyEffects } from './graph/effects';
import type { GraphEffects, SecretsResolver } from './graph/effects';
import { getActiveDormantPolicyIds } from './graph/dormant';
import { syncSecrets } from './secrets/sync';
import type { PushSecretsFn } from './secrets/sync';
import { createSecretsResolver } from './secrets/resolver';

export interface PolicyManagerOptions {
  eventBus?: EventBus;
  /** Callback to push secrets to broker. If not provided, syncSecrets is a no-op. */
  pushSecrets?: PushSecretsFn;
}

export class PolicyManager {
  readonly hierarchy: HierarchyResolver;

  /** The compiled engine — rebuilt on every policy change */
  private engine: CompiledPolicyEngine;

  /** Cache of profile-scoped engines keyed by profileId */
  private profileEngines = new Map<string, { engine: CompiledPolicyEngine; version: number }>();

  private readonly storage: Storage;
  private readonly options: PolicyManagerOptions;

  constructor(storage: Storage, options?: PolicyManagerOptions) {
    this.storage = storage;
    this.options = options ?? {};

    this.hierarchy = new HierarchyResolver(
      storage.policySets,
      storage.policies,
    );

    // Initial compile
    this.engine = this.compileEngine();
  }

  // ---- Core evaluation ----

  /**
   * Evaluate a policy check using the compiled engine (no DB hit for rules).
   *
   * For full graph effects (including secret injection), pass `resolveSecrets: true`
   * which triggers a live graph evaluation against the vault.
   */
  evaluate(input: EvaluationInput & { resolveSecrets?: boolean }): EvaluationResult {
    const engine = input.profileId
      ? this.getProfileEngine(input.profileId)
      : this.engine;
    const result = engine.evaluate(input);

    // If caller wants full graph effects with secret injection, do live eval
    if (input.resolveSecrets && result.policyId) {
      const fullEffects = this.evaluateLiveGraphEffects(
        result.policyId,
        input.profileId,
        input.context,
      );
      if (fullEffects) {
        // Graph deny overrides
        if (fullEffects.denied) {
          return {
            allowed: false,
            policyId: result.policyId,
            reason: fullEffects.denyReason || 'Denied by policy graph edge',
            effects: fullEffects,
            executionContext: input.context,
          };
        }
        return { ...result, effects: fullEffects };
      }
    }

    return result;
  }

  /**
   * Evaluate with full live graph effects (DB hit for activations + secrets).
   * Used by daemon's RPC handler which needs secret injection + activation records.
   */
  evaluateLive(
    input: EvaluationInput,
  ): EvaluationResult {
    return this.evaluate({ ...input, resolveSecrets: true });
  }

  // ---- CRUD (each triggers recompile) ----

  create(input: Parameters<Storage['policies']['create']>[0]): PolicyConfig {
    const result = this.storage.policies.create(input);
    this.recompile();
    return result;
  }

  getById(id: string): PolicyConfig | null {
    return this.storage.policies.getById(id);
  }

  getAll(scope?: ScopeFilter): PolicyConfig[] {
    if (scope) {
      return this.storage.for(scope).policies.getAll();
    }
    return this.storage.policies.getAll();
  }

  getEnabled(scope?: ScopeFilter): PolicyConfig[] {
    if (scope) {
      return this.storage.for(scope).policies.getEnabled();
    }
    return this.storage.policies.getEnabled();
  }

  update(id: string, input: Parameters<Storage['policies']['update']>[1]): PolicyConfig | null {
    const result = this.storage.policies.update(id, input);
    if (result) this.recompile();
    return result;
  }

  delete(id: string): boolean {
    const result = this.storage.policies.delete(id);
    if (result) this.recompile();
    return result;
  }

  /** Seed preset policies */
  seedPreset(presetId: string): number {
    const count = this.storage.policies.seedPreset(presetId);
    if (count > 0) this.recompile();
    return count;
  }

  // ---- Secret sync ----

  /** Sync secrets to broker via the provided push callback */
  async syncSecrets(policies: PolicyConfig[], logger?: { warn: (...args: unknown[]) => void; info: (...args: unknown[]) => void }, scope?: ScopeFilter): Promise<void> {
    if (!this.options.pushSecrets) return;
    await syncSecrets(this.storage, policies, this.options.pushSecrets, logger, scope);
  }

  // ---- Engine management ----

  /** Force recompile (e.g., after graph changes, hierarchy updates, or daemon restart) */
  recompile(): void {
    this.engine = this.compileEngine();
    this.profileEngines.clear();
  }

  /** Get the current engine version (for cache invalidation / debugging) */
  get engineVersion(): number {
    return this.engine.version;
  }

  /** Get the current compiled engine (for advanced use) */
  get compiledEngine(): CompiledPolicyEngine {
    return this.engine;
  }

  // ---- Internal ----

  /**
   * Get or compile a profile-scoped engine (includes both global and profile policies).
   * Cached per profileId, invalidated on recompile().
   */
  private getProfileEngine(profileId: string): CompiledPolicyEngine {
    const cached = this.profileEngines.get(profileId);
    if (cached && cached.version === this.engine.version) {
      return cached.engine;
    }
    const engine = this.compileEngine({ profileId });
    this.profileEngines.set(profileId, { engine, version: this.engine.version });
    return engine;
  }

  private compileEngine(scope?: ScopeFilter): CompiledPolicyEngine {
    const scoped = scope ? this.storage.for(scope) : undefined;
    const policies = scoped
      ? scoped.policies.getEnabled()
      : this.storage.policies.getAll().filter(p => p.enabled);

    let graph: PolicyGraph | undefined;
    try {
      const graphRepo = scoped?.policyGraph ?? this.storage.policyGraph;
      graph = graphRepo.loadGraph();
    } catch {
      // Graph may not be available — compile without it
    }

    return compile({ policies, graph });
  }

  /**
   * Live graph evaluation with DB access for activations + secret resolution.
   */
  private evaluateLiveGraphEffects(
    policyId: string,
    profileId?: string,
    context?: import('@agenshield/ipc').PolicyExecutionContext,
  ): GraphEffects | undefined {
    try {
      const scoped = profileId
        ? this.storage.for({ profileId })
        : this.storage.for({});

      const graph = scoped.policyGraph.loadGraph();
      const secretsRepo = createSecretsResolver(scoped.secrets);
      return evaluateGraphEffects(policyId, graph, scoped.policyGraph, secretsRepo, context);
    } catch {
      return undefined;
    }
  }
}
