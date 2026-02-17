/**
 * @agenshield/policies — Standalone policy manager for AgenShield
 *
 * @packageDocumentation
 */

// Manager
export { PolicyManager } from './manager';
export type { PolicyManagerOptions } from './manager';

// Engine
export { compile, operationToTarget } from './engine';
export { CompiledPolicyEngine } from './engine';
export type {
  CompileInput,
  CompiledEngineData,
  CompiledRule,
  PrecomputedEffects,
  EvaluationInput,
  EvaluationResult,
} from './engine';

// Matcher
export {
  globToRegex,
  normalizeUrlBase,
  normalizeUrlTarget,
  matchUrlPattern,
  checkUrlPolicy,
  extractCommandBasename,
  matchCommandPattern,
  matchFilesystemPattern,
  policyScopeMatches,
  commandScopeMatches,
  filterUrlPoliciesForCommand,
} from './matcher';

// Graph
export { evaluateGraphEffects, emptyEffects, getActiveDormantPolicyIds } from './graph';
export type { GraphEffects, SecretsResolver, DeferredActivation } from './graph';

// Sandbox
export {
  extractConcreteDenyPaths,
  collectDenyPathsFromPolicies,
  collectAllowPathsForCommand,
} from './sandbox';

// Secrets
export { buildSyncPayload, syncSecrets, createSecretsResolver } from './secrets';
export type { PushSecretsFn } from './secrets';

// Presets
export {
  OPENCLAW_PRESET,
  AGENCO_PRESET,
  CLAUDECODE_PRESET,
  POLICY_PRESETS,
  PRESET_MAP,
  getPresetById,
} from './presets';
export type { PolicyPreset } from './presets';

// Hierarchy
export { HierarchyResolver } from './hierarchy';
export type { HierarchyNode, ResolvedHierarchy } from './hierarchy';

// Errors
export {
  PolicyError,
  PolicyNotFoundError,
  PolicySetNotFoundError,
  GraphCycleError,
  GraphEvaluationError,
  SecretResolutionError,
  CompilationError,
} from './errors';
