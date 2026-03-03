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
 * When the command is run via `sudo`, extract the effective command name
 * being delegated (e.g. `sudo -u user claude --serve` → `claude`).
 * Handles combined flags (-Hu user) and --user=xxx / --user xxx forms.
 */
function extractSudoCommand(command: string): string | null {
  const tokens = command.split(/\s+/);
  if (tokens.length < 2) return null;

  const first = tokens[0];
  const sudoBasename = first.includes('/') ? first.split('/').pop()! : first;
  if (sudoBasename.toLowerCase() !== 'sudo') return null;

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith('-')) {
      // First non-flag token is the effective command
      return t;
    }
    // --user=xxx or --user xxx
    if (t === '-u' || t === '--user') { i++; continue; }
    if (t.startsWith('--user=')) continue;
    // Combined short flags containing 'u' (e.g. -Hu, -nHu) — next arg is user
    if (t.startsWith('-') && !t.startsWith('--') && t.includes('u')) { i++; continue; }
  }
  return null;
}

/**
 * Collect all candidate binary/command names from a command line.
 * Includes the primary cmd path, basename, interpreter script candidates,
 * and the effective command from sudo invocations.
 */
function collectCandidates(target: string): { cmd: string; basename: string; extras: string[] } {
  const firstSpace = target.indexOf(' ');
  const cmd = firstSpace >= 0 ? target.slice(0, firstSpace) : target;
  const basename = cmd.includes('/') ? cmd.split('/').pop()! : cmd;

  const extras: string[] = [];

  // Interpreter-aware: script candidates (node script.js → script name)
  const scriptCandidates = extractScriptCandidates(target);
  extras.push(...scriptCandidates);

  // Sudo-aware: extract the effective command being delegated
  const sudoCmd = extractSudoCommand(target);
  if (sudoCmd) {
    const sudoCmdBasename = sudoCmd.includes('/') ? sudoCmd.split('/').pop()! : sudoCmd;
    extras.push(sudoCmd, sudoCmdBasename);
  }

  return { cmd, basename, extras };
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
 * The match is case-insensitive and checks against the binary command
 * path and basename (NOT the full command line with arguments) to avoid
 * false positives when arguments contain matching directory names.
 *
 * **Interpreter-aware**: when the command is run via a known interpreter
 * (node, python, etc.), the script argument's package directory and
 * basename are also checked.
 *
 * **Sudo-aware**: when the command is run via `sudo`, the effective
 * delegated command is extracted and checked.
 */
export function matchProcessPattern(pattern: string, target: string): boolean {
  const trimmed = pattern.trim();

  // Wildcard: matches everything
  if (trimmed === '*') return true;

  const { cmd, basename, extras } = collectCandidates(target);
  const lowerCmd = cmd.toLowerCase();
  const lowerBasename = basename.toLowerCase();

  // Claude Code-style: ":*" suffix = prefix match with optional args
  if (trimmed.endsWith(':*')) {
    const prefix = trimmed.slice(0, -2).toLowerCase();
    if (lowerBasename === prefix || lowerCmd === prefix) return true;
    return extras.some(c => c.toLowerCase() === prefix);
  }

  // Glob-style: contains '*' — convert to regex
  // Match against binary path and basename only (NOT full command line with args)
  // to avoid false positives when args contain matching directory names.
  if (trimmed.includes('*')) {
    const escaped = trimmed.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = escaped.replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexStr}$`, 'i');
    if (regex.test(lowerCmd) || regex.test(lowerBasename)) return true;
    return extras.some(c => regex.test(c.toLowerCase()));
  }

  // No wildcards = exact basename match (case-insensitive)
  const lowerTrimmed = trimmed.toLowerCase();
  if (lowerBasename === lowerTrimmed) return true;
  return extras.some(c => c.toLowerCase() === lowerTrimmed);
}
