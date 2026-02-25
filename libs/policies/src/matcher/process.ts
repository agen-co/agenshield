/**
 * Process pattern matching utilities.
 *
 * Matches process command lines against glob-style patterns.
 * Reuses the same wildcard semantics as command matcher.
 */

const KNOWN_INTERPRETERS = new Set([
  'node', 'python', 'python3', 'ruby', 'java', 'deno', 'bun',
  'ts-node', 'tsx', 'npx',
]);

/**
 * When the command is run via a known interpreter (e.g. `node script.js`),
 * extract candidate names from the script argument so that a policy
 * targeting the logical tool name still matches.
 *
 * Returns candidate names derived from the script path:
 * 1. Package directory from `node_modules/<pkg>/` → `pkg`
 * 2. Script filename without extension → e.g. `dummy-openclaw`
 */
function extractScriptCandidates(command: string): string[] {
  const tokens = command.split(/\s+/);
  if (tokens.length < 2) return [];

  const interpreterToken = tokens[0];
  const interpreter = interpreterToken.includes('/')
    ? interpreterToken.split('/').pop()!
    : interpreterToken;

  if (!KNOWN_INTERPRETERS.has(interpreter.toLowerCase())) return [];

  // Find first non-flag argument after the interpreter
  let scriptPath: string | undefined;
  for (let i = 1; i < tokens.length; i++) {
    if (!tokens[i].startsWith('-')) {
      scriptPath = tokens[i];
      break;
    }
  }
  if (!scriptPath) return [];

  const candidates: string[] = [];

  // 1. Package dir from node_modules/<pkg>/ or site-packages/<pkg>/
  const pkgMatch = scriptPath.match(/(?:node_modules|site-packages)\/([^/]+)\//);
  if (pkgMatch) candidates.push(pkgMatch[1]);

  // 2. Script basename without extension
  const scriptFile = scriptPath.includes('/')
    ? scriptPath.split('/').pop()!
    : scriptPath;
  const dotIdx = scriptFile.lastIndexOf('.');
  const scriptBasename = dotIdx > 0 ? scriptFile.slice(0, dotIdx) : scriptFile;
  if (scriptBasename) candidates.push(scriptBasename);

  return candidates;
}

/**
 * Match a running process command line against a pattern.
 *
 * Semantics (same as command matcher):
 * - `openclaw`     → matches if command basename is "openclaw"
 * - `openclaw:*`   → matches "openclaw" or "openclaw <anything>"
 * - `*claude*`     → matches any command containing "claude"
 * - `*`            → wildcard, matches any process
 *
 * The match is case-insensitive and checks against both the full
 * command line and the extracted basename.
 *
 * **Interpreter-aware**: when the command is run via a known interpreter
 * (node, python, etc.), the script argument's package directory and
 * basename are also checked for exact and `:*` matches.
 */
export function matchProcessPattern(pattern: string, target: string): boolean {
  const trimmed = pattern.trim();

  // Wildcard: matches everything
  if (trimmed === '*') return true;

  const lowerTarget = target.toLowerCase();

  // Extract basename from the command (first token, strip path)
  const firstSpace = target.indexOf(' ');
  const cmd = firstSpace >= 0 ? target.slice(0, firstSpace) : target;
  const basename = cmd.includes('/') ? cmd.split('/').pop()! : cmd;
  const lowerBasename = basename.toLowerCase();

  // Claude Code-style: ":*" suffix = prefix match with optional args
  if (trimmed.endsWith(':*')) {
    const prefix = trimmed.slice(0, -2).toLowerCase();
    if (lowerBasename === prefix || lowerBasename.startsWith(prefix + ' ')
      || lowerTarget === prefix || lowerTarget.startsWith(prefix + ' ')) {
      return true;
    }
    // Interpreter-aware: check script candidates
    const candidates = extractScriptCandidates(target);
    return candidates.some(c => c.toLowerCase() === prefix);
  }

  // Glob-style: contains '*' — convert to regex
  if (trimmed.includes('*')) {
    const escaped = trimmed.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = escaped.replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexStr}$`, 'i');
    return regex.test(lowerTarget) || regex.test(lowerBasename);
  }

  // No wildcards = exact basename match (case-insensitive)
  const lowerTrimmed = trimmed.toLowerCase();
  if (lowerBasename === lowerTrimmed) return true;

  // Interpreter-aware: check script path candidates
  const candidates = extractScriptCandidates(target);
  return candidates.some(c => c.toLowerCase() === lowerTrimmed);
}
