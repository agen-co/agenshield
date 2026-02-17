/**
 * Policy scope matching utilities.
 *
 * Extracted from daemon url-matcher.ts — scope filtering and command-scoped policy logic.
 */

import type { PolicyConfig, PolicyExecutionContext } from '@agenshield/ipc';

/**
 * Check if a policy's scope matches the execution context.
 */
export function policyScopeMatches(policy: PolicyConfig, context?: PolicyExecutionContext): boolean {
  const scope = policy.scope;
  if (!scope) return true;

  // command: scoped policies ONLY apply in the per-run proxy path
  // (via filterUrlPoliciesForCommand), never in evaluatePolicyCheck
  if (scope.startsWith('command:')) {
    return false;
  }

  if (!context) return true;

  if (scope === 'agent') {
    return context.callerType === 'agent';
  }
  if (scope === 'skill') {
    return context.callerType === 'skill';
  }
  if (scope.startsWith('skill:')) {
    const slug = scope.slice(6);
    return context.callerType === 'skill' && context.skillSlug === slug;
  }
  return true;
}

/**
 * Check if a policy's command scope matches a given command basename.
 *
 * - No scope → applies to all commands (universal)
 * - scope 'command:<name>' → only applies when executing that command
 * - Other scopes (agent, skill, skill:<slug>) → ignored for command filtering (treated as universal)
 */
export function commandScopeMatches(policy: PolicyConfig, commandBasename: string): boolean {
  const scope = policy.scope;
  if (!scope) return true; // Universal

  if (scope.startsWith('command:')) {
    const scopeCmd = scope.slice(8); // after 'command:'
    return scopeCmd.toLowerCase() === commandBasename.toLowerCase();
  }

  // Other scope types (agent, skill) → don't restrict by command, treat as universal
  return true;
}

/**
 * Filter URL policies that apply to a specific command.
 * Includes policies with no scope (universal) and those scoped to this command.
 * Returns global (unscoped) first, then command-scoped — consistent ordering.
 */
export function filterUrlPoliciesForCommand(policies: PolicyConfig[], commandBasename: string): PolicyConfig[] {
  const global: PolicyConfig[] = [];
  const scoped: PolicyConfig[] = [];
  for (const p of policies) {
    if (!p.enabled || p.target !== 'url') continue;
    if (!commandScopeMatches(p, commandBasename)) continue;
    if (p.scope?.startsWith('command:')) {
      scoped.push(p);
    } else {
      global.push(p);
    }
  }
  return [...global, ...scoped];
}
