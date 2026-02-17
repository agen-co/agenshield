/**
 * Command pattern matching utilities.
 *
 * Extracted from daemon rpc.ts matchCommandPattern + url-matcher.ts extractCommandBasename.
 */

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
 * Match a command target against a Claude Code-style command pattern.
 *
 * Semantics:
 * - `git`         → exact match only "git" (no args)
 * - `git:*`       → matches "git" or "git <anything>"
 * - `git push`    → exact match "git push" only
 * - `git push:*`  → matches "git push" or "git push <anything>"
 * - `*`           → wildcard, matches any command
 *
 * No ** or ? glob syntax for commands.
 */
export function matchCommandPattern(pattern: string, target: string): boolean {
  const trimmed = pattern.trim();

  // Wildcard: matches everything
  if (trimmed === '*') return true;

  // Normalize: extract basename from absolute command paths
  // e.g. "/usr/bin/curl https://david.com" → "curl https://david.com"
  let normalizedTarget = target;
  const firstSpace = target.indexOf(' ');
  const cmd = firstSpace >= 0 ? target.slice(0, firstSpace) : target;
  if (cmd.startsWith('/')) {
    const basename = cmd.split('/').pop() || cmd;
    normalizedTarget = firstSpace >= 0 ? basename + target.slice(firstSpace) : basename;
  }

  // Claude Code-style: ":*" suffix = prefix match with optional args
  if (trimmed.endsWith(':*')) {
    let prefix = trimmed.slice(0, -2);
    // Normalize: strip absolute path to basename (same as target normalization)
    if (prefix.includes('/')) {
      prefix = prefix.split('/').pop() || prefix;
    }
    const lowerTarget = normalizedTarget.toLowerCase();
    const lowerPrefix = prefix.toLowerCase();
    return lowerTarget === lowerPrefix || lowerTarget.startsWith(lowerPrefix + ' ');
  }

  // No ":*" = exact match (case-insensitive), normalize pattern too
  let normalizedPattern = trimmed;
  if (trimmed.includes('/')) {
    normalizedPattern = trimmed.split('/').pop() || trimmed;
  }
  return normalizedTarget.toLowerCase() === normalizedPattern.toLowerCase();
}
