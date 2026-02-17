/**
 * Re-export graph evaluator from @agenshield/policies.
 *
 * This file is kept for backward compatibility.
 */

export {
  evaluateGraphEffects,
  emptyEffects,
  getActiveDormantPolicyIds,
} from '@agenshield/policies';

export type { GraphEffects } from '@agenshield/policies';
