/**
 * High-level API for shielded process detection.
 *
 * Provides simple boolean and detailed analysis wrappers around
 * the command parser. Used by the process enforcer to skip
 * AgenShield-managed sudo delegations.
 */

import {
  detectShieldedExecution,
  type ShieldedExecutionInfo,
} from './command-parser';

/**
 * Check whether a process command line represents an AgenShield-shielded
 * execution (sudo delegation to a known agent user).
 *
 * Drop-in replacement for the old `isSudoDelegation()` regex.
 */
export function isShieldedProcess(
  command: string,
  agentUsernames: Set<string>,
): boolean {
  return detectShieldedExecution(command, agentUsernames).isShielded;
}

/**
 * Full analysis of a process command line for shielded execution markers.
 *
 * Returns detailed info including agent user, guarded-shell usage,
 * and the effective inner command. Useful for logging and debugging.
 */
export function analyzeShieldedProcess(
  command: string,
  agentUsernames: Set<string>,
): ShieldedExecutionInfo {
  return detectShieldedExecution(command, agentUsernames);
}
