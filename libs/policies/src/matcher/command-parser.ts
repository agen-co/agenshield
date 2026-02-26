/**
 * Command-line parsing utilities for process detection.
 *
 * Provides tokenization, sudo flag parsing, and shielded execution
 * detection for ps output analysis. Used by the process enforcer to
 * distinguish AgenShield-managed processes from unmanaged ones.
 */

// ─── Types ───────────────────────────────────────────────────

export interface ParsedSudoCommand {
  /** The user sudo delegates to (-u / --user), or null if not specified */
  targetUser: string | null;
  /** Whether -H (set HOME) was present */
  setHome: boolean;
  /** The inner command string (everything after sudo flags) */
  innerCommand: string;
  /** The inner command as tokens */
  innerTokens: string[];
}

export interface ShieldedExecutionInfo {
  /** Whether this process is a shielded AgenShield execution */
  isShielded: boolean;
  /** The agent user being delegated to, if detected */
  agentUser: string | null;
  /** Whether guarded-shell is in the execution chain */
  usesGuardedShell: boolean;
  /** Whether AGENSHIELD_HOST_CWD env marker is present */
  hasHostCwdMarker: boolean;
  /** The effective command being run inside the shield, if detectable */
  effectiveCommand: string | null;
}

// ─── Sudo flag constants ─────────────────────────────────────

/** Short flags that consume the next token (or remainder) as a value */
const VALUE_FLAGS = new Set(['u', 'g', 'C', 'D', 'R', 'T']);

/** Short flags that are boolean (no value) */
const BOOLEAN_FLAGS = new Set([
  'A', 'b', 'E', 'e', 'H', 'h', 'i', 'K', 'k', 'l', 'n',
  'P', 'p', 'S', 's', 'V', 'v', 'B',
]);

// ─── Tokenizer ───────────────────────────────────────────────

/**
 * Tokenize a ps command-line string into an array of tokens.
 *
 * Handles:
 * - Whitespace splitting (multiple spaces)
 * - Single-quoted strings (as produced by `sh -c '...'`)
 * - Double-quoted strings
 * - Escaped characters within quotes
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (ch === "'" || ch === '"') {
      // Quoted segment — collect until matching close quote
      const quote = ch;
      i++;
      while (i < command.length && command[i] !== quote) {
        if (command[i] === '\\' && quote === '"' && i + 1 < command.length) {
          i++;
          current += command[i];
        } else {
          current += command[i];
        }
        i++;
      }
      // skip closing quote
      if (i < command.length) i++;
    } else if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

// ─── Sudo parser ─────────────────────────────────────────────

/**
 * Parse a tokenized command as a sudo invocation.
 *
 * Handles all common sudo flag formats:
 * - `-u <user>`, `-u<user>` (short with space or attached)
 * - `-Hu <user>`, `-nHu<user>` (combined short flags)
 * - `--user=<user>`, `--user <user>` (GNU long form)
 * - `--` explicit end-of-flags
 * - Value-consuming flags: -g, -C, -D, -R, -T
 *
 * Returns null if the first token is not `sudo` (or `/usr/bin/sudo`, etc.).
 */
export function parseSudoCommand(tokens: string[]): ParsedSudoCommand | null {
  if (tokens.length === 0) return null;

  // First token must be sudo (possibly with full path)
  const first = tokens[0];
  const basename = first.includes('/') ? first.split('/').pop()! : first;
  if (basename !== 'sudo') return null;

  let targetUser: string | null = null;
  let setHome = false;
  let i = 1;

  while (i < tokens.length) {
    const tok = tokens[i];

    // Explicit end of flags
    if (tok === '--') {
      i++;
      break;
    }

    // Long options
    if (tok.startsWith('--')) {
      if (tok.startsWith('--user=')) {
        targetUser = tok.slice('--user='.length);
        i++;
        continue;
      }
      if (tok === '--user') {
        i++;
        if (i < tokens.length) {
          targetUser = tokens[i];
          i++;
        }
        continue;
      }
      // Other long flags (--preserve-env, --login, etc.) — skip
      i++;
      continue;
    }

    // Short option cluster (e.g. -Hu, -nHuagent, -u agent)
    if (tok.startsWith('-') && tok.length > 1 && tok[1] !== '-') {
      let j = 1; // position within the flag cluster
      while (j < tok.length) {
        const flag = tok[j];

        if (flag === 'H') {
          setHome = true;
          j++;
          continue;
        }

        if (VALUE_FLAGS.has(flag)) {
          // The remainder of this token (after the flag char) is the value,
          // or if nothing remains, the next token is the value
          const remainder = tok.slice(j + 1);
          if (remainder.length > 0) {
            if (flag === 'u') targetUser = remainder;
            // For other value flags (g, C, D, R, T) we just consume the value
          } else {
            // Value is the next token
            i++;
            if (i < tokens.length) {
              if (flag === 'u') targetUser = tokens[i];
            }
          }
          // Either way, done with this token cluster
          break;
        }

        if (BOOLEAN_FLAGS.has(flag)) {
          j++;
          continue;
        }

        // Unknown flag — treat as boolean and continue
        j++;
      }
      i++;
      continue;
    }

    // Not a flag — this is the start of the inner command
    break;
  }

  const innerTokens = tokens.slice(i);
  const innerCommand = innerTokens.join(' ');

  return { targetUser, setHome, innerCommand, innerTokens };
}

// ─── Shielded execution detection ────────────────────────────

const GUARDED_SHELL_MARKER = '.agenshield/bin/guarded-shell';
const HOST_CWD_MARKER = 'AGENSHIELD_HOST_CWD';

/**
 * Detect whether a ps command line represents an AgenShield-shielded execution.
 *
 * Checks:
 * 1. Whether the command is a sudo delegation to a known agent username
 * 2. Whether guarded-shell appears in the execution chain
 * 3. Whether the AGENSHIELD_HOST_CWD env marker is present
 *
 * A process is considered "shielded" if it delegates via sudo to a known
 * agent user. The guarded-shell and host-cwd markers provide additional
 * confidence but are not required for the shielded determination.
 */
export function detectShieldedExecution(
  command: string,
  agentUsernames: Set<string>,
): ShieldedExecutionInfo {
  const tokens = tokenizeCommand(command);
  const parsed = parseSudoCommand(tokens);

  // Check for markers in the full command string (fast string checks)
  const usesGuardedShell = command.includes(GUARDED_SHELL_MARKER);
  const hasHostCwdMarker = command.includes(HOST_CWD_MARKER);

  if (!parsed || !parsed.targetUser) {
    return {
      isShielded: false,
      agentUser: null,
      usesGuardedShell,
      hasHostCwdMarker,
      effectiveCommand: null,
    };
  }

  const isKnownAgent = agentUsernames.has(parsed.targetUser);

  // Try to extract the effective command from guarded-shell -c '...'
  let effectiveCommand: string | null = null;
  if (parsed.innerTokens.length > 0) {
    const innerStr = parsed.innerCommand;
    // Look for guarded-shell ... -c '...' pattern
    const cFlagIdx = parsed.innerTokens.indexOf('-c');
    if (cFlagIdx >= 0 && cFlagIdx + 1 < parsed.innerTokens.length) {
      effectiveCommand = parsed.innerTokens[cFlagIdx + 1];
    } else {
      effectiveCommand = innerStr;
    }
  }

  return {
    isShielded: isKnownAgent,
    agentUser: parsed.targetUser,
    usesGuardedShell,
    hasHostCwdMarker,
    effectiveCommand,
  };
}
