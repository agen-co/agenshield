/**
 * Compiled Policy Engine types
 */

import type { PolicyExecutionContext } from '@agenshield/ipc';
import type { GraphEffects } from '../graph/effects';

/** A pre-compiled rule for fast runtime matching */
export interface CompiledRule {
  policyId: string;
  action: 'allow' | 'deny' | 'approval';
  priority: number;
  /** Pre-compiled matchers — returns true if target matches */
  matchers: Array<(target: string) => boolean>;
  /** Scope matcher (pre-bound) */
  scopeMatch: (context?: PolicyExecutionContext) => boolean;
  /** Operations filter (null = all operations) */
  operations: Set<string> | null;
}

/** Pre-computed effects from graph evaluation (no graph walk at runtime) */
export interface PrecomputedEffects {
  grantedNetworkPatterns: string[];
  grantedFsPaths: { read: string[]; write: string[] };
  /** Secret names to resolve (resolved at eval time since vault state can change) */
  secretNames: string[];
  activatesPolicyIds: string[];
  denied: boolean;
  denyReason?: string;
}

/** Input for policy evaluation */
export interface EvaluationInput {
  operation: string;
  target: string;
  context?: PolicyExecutionContext;
  profileId?: string;
  /** Default action when no policy matches */
  defaultAction?: 'allow' | 'deny';
}

/** Result of policy evaluation */
export interface EvaluationResult {
  allowed: boolean;
  policyId?: string;
  reason?: string;
  effects?: GraphEffects;
  executionContext?: PolicyExecutionContext;
}
