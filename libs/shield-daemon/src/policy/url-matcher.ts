/**
 * URL and pattern matching utilities shared between RPC handlers and proxy.
 *
 * Extracted from rpc.ts so the per-run proxy can reuse the same matching logic.
 */

import type { PolicyConfig, PolicyExecutionContext } from '@agenshield/ipc';

/**
 * Convert a glob pattern to a RegExp (same algorithm as broker's PolicyEnforcer.matchPattern)
 */
export function globToRegex(pattern: string): RegExp {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars except * and ?
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/{{GLOBSTAR}}/g, '.*');

  return new RegExp(`^${regexPattern}$`, 'i');
}

/**
 * Normalize a URL pattern base:
 * - Strip trailing slashes
 * - If pattern is a bare domain (no protocol), prefix with https://
 */
export function normalizeUrlBase(pattern: string): string {
  let p = pattern.trim();
  p = p.replace(/\/+$/, '');
  if (!p.match(/^(\*|https?):\/\//i)) {
    p = `https://${p}`;
  }
  return p;
}

/**
 * Normalize a URL target for matching:
 * - Ensures there's always a path (at least '/') for matching against ** patterns
 * - Strips trailing slashes from paths (but keeps root '/')
 */
export function normalizeUrlTarget(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    let path = parsed.pathname;
    if (path.length > 1) {
      path = path.replace(/\/+$/, '');
    }
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

/**
 * Match a URL target against a URL pattern.
 * For patterns without wildcards, matches both the exact URL and any sub-paths.
 * For patterns with wildcards, matches as-is.
 * Bare domain patterns (e.g. "facebook.com") also match "www.facebook.com".
 */
export function matchUrlPattern(pattern: string, target: string): boolean {
  const base = normalizeUrlBase(pattern);
  const trimmed = pattern.trim().replace(/\/+$/, '');

  if (trimmed.endsWith('*')) {
    return globToRegex(base).test(target);
  }

  if (globToRegex(base).test(target) || globToRegex(`${base}/**`).test(target)) {
    return true;
  }

  // Bare domain: also match www. subdomain variant
  // e.g. pattern "facebook.com" → also try "https://www.facebook.com/**"
  const stripped = trimmed.replace(/^(https?:\/\/)/i, '');
  if (!stripped.startsWith('www.') && !stripped.includes('*')) {
    const wwwBase = base.replace(/:\/\//, '://www.');
    if (globToRegex(wwwBase).test(target) || globToRegex(`${wwwBase}/**`).test(target)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a policy's scope matches the execution context.
 */
export function policyScopeMatches(policy: PolicyConfig, context?: PolicyExecutionContext): boolean {
  const scope = policy.scope;
  if (!scope) return true;
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
 * Extract the basename of a command target.
 * "/usr/bin/curl -s https://x.com" → "curl"
 * "fork:git push" → "git"
 * "node script.js" → "node"
 */
export function extractCommandBasename(target: string): string {
  const clean = target.startsWith('fork:') ? target.slice(5) : target;
  const cmdPart = clean.split(' ')[0] || '';
  return cmdPart.includes('/') ? cmdPart.split('/').pop()! : cmdPart;
}

/**
 * Check if a URL policy applies to a given command.
 *
 * - No scope → applies to all commands (universal)
 * - scope 'command:<name>' → only applies when executing that command
 * - Other scopes (agent, skill, skill:<slug>) → ignored for command filtering (treated as universal)
 */
export function urlPolicyScopeMatchesCommand(policy: PolicyConfig, commandBasename: string): boolean {
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
 */
export function filterUrlPoliciesForCommand(policies: PolicyConfig[], commandBasename: string): PolicyConfig[] {
  return policies.filter(
    (p) => p.enabled && p.target === 'url' && urlPolicyScopeMatchesCommand(p, commandBasename)
  );
}

/**
 * Check whether a URL (or hostname) is allowed by a set of URL policies.
 *
 * Used by the per-run proxy to enforce URL policies on CONNECT/HTTP requests.
 * Logic mirrors evaluatePolicyCheck but only for URL target type.
 *
 * Returns true if allowed (including default-allow when no policy matches).
 */
export function checkUrlPolicy(policies: PolicyConfig[], url: string): boolean {
  const applicable = policies
    .filter((p) => p.enabled && p.target === 'url')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const effectiveTarget = normalizeUrlTarget(url);

  // Block plain HTTP by default unless explicitly allowed
  if (url.match(/^http:\/\//i)) {
    let explicitHttpAllow = false;
    for (const policy of applicable) {
      if (policy.action !== 'allow') continue;
      for (const pattern of policy.patterns) {
        if (!pattern.match(/^http:\/\//i)) continue;
        if (matchUrlPattern(pattern, effectiveTarget)) {
          explicitHttpAllow = true;
          break;
        }
      }
      if (explicitHttpAllow) break;
    }
    if (!explicitHttpAllow) return false;
  }

  for (const policy of applicable) {
    if (policy.target !== 'url') continue;

    for (const pattern of policy.patterns) {
      if (matchUrlPattern(pattern, effectiveTarget)) {
        return policy.action === 'allow';
      }
    }
  }

  // Default: allow (no matching policy)
  return true;
}
