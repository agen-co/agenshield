/**
 * Security status checks for the sandbox
 */

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { userExistsSync as userExists, GUARDED_SHELL_PATH } from '../legacy.js';
import { tokenizeCommand, parseSudoCommand } from '@agenshield/policies';

const execAsync = promisify(exec);

/** Legacy/fallback sandbox user names */
const LEGACY_SANDBOX_USERS = ['ash_default_agent', 'ash_default_broker', 'openclaw', 'agentshield_default_agent'];

/** Prefixes used by AgenShield sandbox users (current + legacy) */
const SANDBOX_USER_PREFIXES = ['agentshield_', 'ash_'];

/**
 * Discover sandbox users from the system via dscl
 */
async function discoverSandboxUsers(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('dscl . -list /Users', {
      encoding: 'utf-8',
    });
    return stdout
      .split('\n')
      .filter((u) => SANDBOX_USER_PREFIXES.some((prefix) => u.startsWith(prefix)));
  } catch {
    return [];
  }
}

/**
 * Build the effective list of sandbox users to check against.
 * Priority: explicit known users > dscl discovery > legacy fallback
 */
async function resolveSandboxUsers(knownUsers?: string[]): Promise<string[]> {
  if (knownUsers && knownUsers.length > 0) {
    return knownUsers;
  }
  const discovered = await discoverSandboxUsers();
  if (discovered.length > 0) {
    return discovered;
  }
  return LEGACY_SANDBOX_USERS;
}

/**
 * Security status report
 */
export interface SecurityStatus {
  /** Is the current process running as root? (dangerous!) */
  runningAsRoot: boolean;
  /** Current user */
  currentUser: string;
  /** Is sandbox user created? */
  sandboxUserExists: boolean;
  /** Is OpenClaw isolated to sandbox user? */
  isIsolated: boolean;
  /** Is guarded shell installed? */
  guardedShellInstalled: boolean;
  /** Exposed secrets found in environment */
  exposedSecrets: string[];
  /** Security warnings */
  warnings: string[];
  /** Critical security issues */
  critical: string[];
  /** Recommendations */
  recommendations: string[];
  /** Overall security level */
  level: 'secure' | 'partial' | 'unprotected' | 'critical';
}

/**
 * Known secret environment variable patterns
 */
const SECRET_PATTERNS = [
  /^TWILIO_/i,
  /^OPENAI_/i,
  /^ANTHROPIC_/i,
  /^GOOGLE_.*TOKEN/i,
  /^GOOGLE_.*KEY/i,
  /^GOOGLE_.*SECRET/i,
  /^AWS_/i,
  /^STRIPE_/i,
  /^GITHUB_TOKEN/i,
  /^NPM_TOKEN/i,
  /_API_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /_AUTH$/i,
];

/**
 * Check if an environment variable name looks like a secret
 */
export function isSecretEnvVar(name: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Check for secrets exposed in environment
 */
function checkExposedSecrets(env?: Record<string, string | undefined>): string[] {
  const target = env ?? process.env;
  const exposed: string[] = [];
  for (const [key, value] of Object.entries(target)) {
    if (value && isSecretEnvVar(key)) {
      exposed.push(key);
    }
  }
  return exposed;
}

/**
 * Execute a command safely (async)
 */
async function execSafe(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(cmd, { encoding: 'utf-8' });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Default process name patterns for OpenClaw (used when no targets are provided) */
const DEFAULT_PROCESS_PATTERNS = ['openclaw', 'clawbot'];

/**
 * Parse ps aux output lines into process records
 */
function parsePsLines(output: string): Array<{ pid: string; user: string; command: string }> {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        user: parts[0],
        pid: parts[1],
        command: parts.slice(10).join(' '),
      };
    });
}

/**
 * Build a grep-safe pattern using the bracket trick to exclude the grep process itself.
 * e.g., "openclaw" → "[o]penclaw"
 */
function bracketEscape(pattern: string): string {
  if (pattern.length < 2) return pattern;
  return `[${pattern[0]}]${pattern.slice(1)}`;
}

/**
 * Find processes matching the given name patterns via ps aux + grep
 */
async function findProcessesByPatterns(
  patterns: string[],
): Promise<Array<{ pid: string; user: string; command: string }>> {
  if (patterns.length === 0) return [];
  const grepExpr = patterns.map(bracketEscape).join('|');
  const output = await execSafe(`ps aux | grep -iE '${grepExpr}'`);
  if (!output) return [];
  return parsePsLines(output);
}

/**
 * Check guarded shells — per-target when targets have agentHomeDir, legacy fallback otherwise.
 */
function checkGuardedShells(
  targets?: TargetProcessMapping[],
): { installed: boolean; missing: string[] } {
  if (targets && targets.length > 0) {
    const missing: string[] = [];
    for (const t of targets) {
      if (!t.agentHomeDir) continue;
      const shellPath = `${t.agentHomeDir}/.agenshield/bin/guarded-shell`;
      try {
        fs.accessSync(shellPath);
      } catch {
        missing.push(t.targetName);
      }
    }
    return { installed: missing.length === 0, missing };
  }
  // Legacy fallback
  try {
    fs.accessSync(GUARDED_SHELL_PATH);
    return { installed: true, missing: [] };
  } catch {
    return { installed: false, missing: ['(legacy)'] };
  }
}

/**
 * Target-to-user mapping for cross-target process validation
 */
export interface TargetProcessMapping {
  /** Target name (e.g., "openclaw") */
  targetName: string;
  /** Sandbox users assigned to this target */
  users: string[];
  /** Process name patterns to match (defaults to [targetName]) */
  processPatterns?: string[];
  /** Agent home directory for per-target guarded shell check */
  agentHomeDir?: string;
}

/**
 * Options for security status checks
 */
export interface SecurityCheckOptions {
  /** Environment to scan for secrets (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** Known sandbox usernames (flat list, for basic isolation checks) */
  knownSandboxUsers?: string[];
  /** Target-to-user mappings for per-target process validation. Supersedes knownSandboxUsers. */
  knownTargets?: TargetProcessMapping[];
  /** If 'daemon', suppress the runningAsRoot critical message (daemon is expected to be root) */
  callerRole?: 'daemon' | 'target';
}

/**
 * Check full security status
 */
export async function checkSecurityStatus(options?: SecurityCheckOptions): Promise<SecurityStatus> {
  const currentUser = os.userInfo().username;
  const runningAsRoot = process.getuid?.() === 0 || currentUser === 'root';
  const warnings: string[] = [];
  const critical: string[] = [];
  const recommendations: string[] = [];

  const knownTargets = options?.knownTargets;
  const hasTargets = knownTargets && knownTargets.length > 0;

  // Resolve effective sandbox users — derive from targets when available
  const sandboxUsers = hasTargets
    ? [...new Set(knownTargets.flatMap((t) => t.users))]
    : await resolveSandboxUsers(options?.knownSandboxUsers);

  // Check sandbox user
  const sandboxUserExists = sandboxUsers.some((u) => userExists(u));
  const guardedShellCheck = checkGuardedShells(knownTargets);
  const guardedShellInstalled = guardedShellCheck.installed;

  // Check if target processes are running in sandbox
  const allPatterns = hasTargets
    ? [...new Set(knownTargets.flatMap((t) => t.processPatterns ?? [t.targetName]))]
    : DEFAULT_PROCESS_PATTERNS;
  const processes = await findProcessesByPatterns(allPatterns);
  // Filter out short-lived installer processes (npm install, node setup scripts) from unisolated list
  const INSTALLER_PATTERNS = ['npm ', 'npm install', 'node setup', 'node install', 'brew ', 'dummy-openclaw'];

  // Detect sudo delegation: `sudo -u {sandboxUser}` wrappers run as root but
  // correctly delegate to the agent user — not a security violation.
  const isSudoDelegation = (proc: { user: string; command: string }) => {
    if (proc.user !== 'root') return false;
    const tokens = tokenizeCommand(proc.command);
    const parsed = parseSudoCommand(tokens);
    return !!parsed?.targetUser && sandboxUsers.includes(parsed.targetUser);
  };

  // macOS setup commands that run as root during `agenshield install`.
  // These are expected: user creation (dscl), group membership (dseditgroup),
  // home dir setup (createhomedir), ownership changes (chown), and config copies (cp).
  const SETUP_COMMAND_PREFIXES = ['dscl ', 'dseditgroup ', 'createhomedir ', 'chown ', 'cp '];

  const isSetupCommand = (proc: { user: string; command: string }) => {
    if (proc.user !== 'root') return false;
    const cmd = proc.command;
    const matchesPrefix = SETUP_COMMAND_PREFIXES.some((pat) => cmd.includes(pat));
    if (!matchesPrefix) return false;
    // Only allow if the command targets a known sandbox user or their home path
    return sandboxUsers.some(
      (u) => cmd.includes(u) || cmd.includes(`/Users/${u}`),
    );
  };

  // AgenShield management commands that run as root but are NOT security violations:
  //  1. launchctl commands managing com.agenshield.* services
  //  2. Lifecycle delegation: sudo -u <hostUser> <target> gateway stop / daemon stop
  //  3. pkill cleanup commands targeting the process patterns
  const LIFECYCLE_SUBCOMMANDS = ['gateway stop', 'daemon stop', 'gateway restart', 'daemon restart'];

  const isAgenshieldManagement = (proc: { user: string; command: string }) => {
    if (proc.user !== 'root') return false;
    const cmd = proc.command;

    // 1. launchctl managing agenshield services
    if (cmd.includes('launchctl') && cmd.includes('com.agenshield.')) return true;

    // 2. Lifecycle delegation via sudo -u <hostUser>
    const tokens = tokenizeCommand(cmd);
    const parsed = parseSudoCommand(tokens);
    if (parsed?.targetUser === currentUser) {
      const inner = parsed.innerCommand;
      if (LIFECYCLE_SUBCOMMANDS.some((sub) => inner.includes(sub))) return true;
    }

    // 3. pkill cleanup commands referencing the host user or a target pattern
    if (cmd.includes('pkill')) {
      if (cmd.includes(currentUser) || allPatterns.some((pat) => cmd.includes(pat))) return true;
    }

    return false;
  };

  const unIsolatedProcesses = processes.filter(
    (p) =>
      !sandboxUsers.includes(p.user) &&
      !INSTALLER_PATTERNS.some((pat) => p.command.includes(pat)) &&
      !isSudoDelegation(p) &&
      !isSetupCommand(p) &&
      !isAgenshieldManagement(p),
  );
  const isIsolated = sandboxUserExists && unIsolatedProcesses.length === 0;

  // Check exposed secrets
  const exposedSecrets = checkExposedSecrets(options?.env);

  // Build warnings and recommendations
  if (runningAsRoot && options?.callerRole !== 'daemon') {
    critical.push('DANGER: Running as root! OpenClaw should never run as root.');
    recommendations.push('Run AgenShield setup to isolate OpenClaw in unprivileged sandbox');
  }

  if (!sandboxUserExists && hasTargets) {
    warnings.push('No sandbox user found (checked: ' + sandboxUsers.join(', ') + ')');
    recommendations.push('Run "agenshield setup" to create isolated sandbox user');
  }

  if (unIsolatedProcesses.length > 0) {
    for (const proc of unIsolatedProcesses) {
      warnings.push(`Target process running as user "${proc.user}" (PID ${proc.pid}): ${proc.command}`);
    }
    recommendations.push('Stop unisolated processes and restart via sandbox');
  }

  if (exposedSecrets.length > 0) {
    warnings.push(`${exposedSecrets.length} secrets exposed in environment`);
    recommendations.push('Secrets should be managed by AgenShield broker, not environment variables');
  }

  // Only warn about missing guarded shell when active target profiles exist.
  // Orphan sandbox users without profiles are stale leftovers — no agent process
  // is running that needs shell restriction, so the warning is misleading.
  if (!guardedShellInstalled && sandboxUserExists && hasTargets) {
    const missingHint =
      guardedShellCheck.missing.length > 0
        ? ` (${guardedShellCheck.missing.join(', ')})`
        : '';
    warnings.push(`Guarded shell not installed${missingHint} - sandbox may not be fully restricted`);
    recommendations.push('Re-run setup to install guarded shell');
  }

  // Cross-target process validation: verify each target's processes run under its own users.
  // Group targets by their effective process patterns so that multiple profiles for the same
  // preset (e.g., two "OpenClaw" installations) merge their user sets — we can't distinguish
  // which process belongs to which profile of the same type.
  if (hasTargets) {
    const allTargetUsers = new Set(sandboxUsers);
    let hasCrossTargetIssue = false;

    // Build merged pattern groups: each unique pattern key maps to the union of all users
    // from targets sharing those patterns.
    const patternGroupMap = new Map<string, { patterns: string[]; users: Set<string>; targetNames: string[] }>();
    for (const target of knownTargets) {
      const patterns = target.processPatterns ?? [target.targetName];
      const key = patterns.slice().sort().join('\0');
      const existing = patternGroupMap.get(key);
      if (existing) {
        for (const u of target.users) existing.users.add(u);
        if (!existing.targetNames.includes(target.targetName)) {
          existing.targetNames.push(target.targetName);
        }
      } else {
        patternGroupMap.set(key, {
          patterns,
          users: new Set(target.users),
          targetNames: [target.targetName],
        });
      }
    }

    for (const group of patternGroupMap.values()) {
      const targetProcesses = await findProcessesByPatterns(group.patterns);

      for (const proc of targetProcesses) {
        // Skip processes under non-sandbox users — already caught by unIsolatedProcesses check above
        if (!allTargetUsers.has(proc.user)) continue;
        // Flag processes running under a different target group's sandbox user
        if (!group.users.has(proc.user)) {
          const ownerTarget = knownTargets.find((t) => t.users.includes(proc.user));
          warnings.push(
            `Cross-target: "${group.targetNames.join('/')}" process (PID ${proc.pid}) running under ` +
              `"${ownerTarget?.targetName ?? 'unknown'}" sandbox user "${proc.user}"`,
          );
          hasCrossTargetIssue = true;
        }
      }
    }

    if (hasCrossTargetIssue) {
      recommendations.push('Restart affected targets to ensure processes run under correct sandbox users');
    }
  }

  // Determine security level
  let level: SecurityStatus['level'];
  if (critical.length > 0) {
    level = 'critical';
  } else if (isIsolated && warnings.length === 0) {
    level = 'secure';
  } else if (sandboxUserExists) {
    level = 'partial';
  } else {
    level = 'unprotected';
  }

  return {
    runningAsRoot,
    currentUser,
    sandboxUserExists,
    isIsolated,
    guardedShellInstalled,
    exposedSecrets,
    warnings,
    critical,
    recommendations,
    level,
  };
}
