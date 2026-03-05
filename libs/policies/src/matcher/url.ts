/**
 * URL pattern matching utilities.
 *
 * Extracted from daemon url-matcher.ts — reusable across daemon, proxy, and engine.
 */

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
 * Check whether a URL (or hostname) is allowed by a set of URL policies.
 *
 * Used by the per-run proxy to enforce URL policies on CONNECT/HTTP requests.
 * Logic mirrors evaluatePolicyCheck but only for URL target type.
 *
 * Returns true if allowed (including default-allow when no policy matches).
 */
export function checkUrlPolicy(
  policies: import('@agenshield/ipc').PolicyConfig[],
  url: string,
  defaultAction: 'allow' | 'deny' = 'deny',
): boolean {
  const applicable = policies
    .filter((p) => p.enabled && p.target === 'url')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const effectiveTarget = normalizeUrlTarget(url);

  // Plain HTTP to non-localhost destinations is blocked by default
  // unless there is an explicit allow policy with an http:// pattern.
  // Localhost HTTP (127.0.0.1, ::1, localhost) is always evaluated
  // through the normal policy pipeline — this is needed for local
  // dev servers, proxied tools, etc.
  if (url.match(/^http:\/\//i)) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const isLocalhost =
        host === '127.0.0.1' || host === '::1' || host === 'localhost';
      if (!isLocalhost) {
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
    } catch {
      // If the URL can't be parsed, fall through to normal policy check
    }
  }

  for (const policy of applicable) {
    if (policy.target !== 'url') continue;

    for (const pattern of policy.patterns) {
      if (matchUrlPattern(pattern, effectiveTarget)) {
        return policy.action === 'allow';
      }
    }
  }

  // Default: use configured action
  return defaultAction === 'allow';
}
