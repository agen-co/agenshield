/**
 * Security status checks for the sandbox
 */

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { userExists } from './macos';
import { GUARDED_SHELL_PATH } from './guarded-shell';

/** Legacy/fallback sandbox user names */
const LEGACY_SANDBOX_USERS = ['openclaw', 'agentshield_default_agent'];

/** Prefixes used by AgenShield sandbox users (current + legacy) */
const SANDBOX_USER_PREFIXES = ['agentshield_', 'ash_'];

/**
 * Discover sandbox users from the system via dscl
 */
function discoverSandboxUsers(): string[] {
  try {
    const output = execSync('dscl . -list /Users', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output
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
function resolveSandboxUsers(knownUsers?: string[]): string[] {
  if (knownUsers && knownUsers.length > 0) {
    return knownUsers;
  }
  const discovered = discoverSandboxUsers();
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
 * Execute a command safely
 */
function execSafe(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
function findProcessesByPatterns(
  patterns: string[],
): Array<{ pid: string; user: string; command: string }> {
  if (patterns.length === 0) return [];
  const grepExpr = patterns.map(bracketEscape).join('|');
  const output = execSafe(`ps aux | grep -iE '${grepExpr}'`);
  if (!output) return [];
  return parsePsLines(output);
}

/**
 * Check if guarded shell is installed
 */
function isGuardedShellInstalled(): boolean {
  try {
    fs.accessSync(GUARDED_SHELL_PATH);
    return true;
  } catch {
    return false;
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
}

/**
 * Check full security status
 */
export function checkSecurityStatus(options?: SecurityCheckOptions): SecurityStatus {
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
    : resolveSandboxUsers(options?.knownSandboxUsers);

  // Check sandbox user
  const sandboxUserExists = sandboxUsers.some((u) => userExists(u));
  const guardedShellInstalled = isGuardedShellInstalled();

  // Check if target processes are running in sandbox
  const allPatterns = hasTargets
    ? [...new Set(knownTargets.flatMap((t) => t.processPatterns ?? [t.targetName]))]
    : DEFAULT_PROCESS_PATTERNS;
  const processes = findProcessesByPatterns(allPatterns);
  const unIsolatedProcesses = processes.filter((p) => !sandboxUsers.includes(p.user));
  const isIsolated = sandboxUserExists && unIsolatedProcesses.length === 0;

  // Check exposed secrets
  const exposedSecrets = checkExposedSecrets(options?.env);

  // Build warnings and recommendations
  if (runningAsRoot) {
    critical.push('DANGER: Running as root! OpenClaw should never run as root.');
    recommendations.push('Run AgenShield setup to isolate OpenClaw in unprivileged sandbox');
  }

  if (!sandboxUserExists) {
    warnings.push('No sandbox user found (checked: ' + sandboxUsers.join(', ') + ')');
    recommendations.push('Run "agenshield setup" to create isolated sandbox user');
  }

  if (unIsolatedProcesses.length > 0) {
    for (const proc of unIsolatedProcesses) {
      warnings.push(`OpenClaw process running as user "${proc.user}" (PID ${proc.pid})`);
    }
    recommendations.push('Stop unisolated processes and restart via sandbox');
  }

  if (exposedSecrets.length > 0) {
    warnings.push(`${exposedSecrets.length} secrets exposed in environment`);
    recommendations.push('Secrets should be managed by AgenShield broker, not environment variables');
  }

  if (!guardedShellInstalled && sandboxUserExists) {
    warnings.push('Guarded shell not installed - sandbox may not be fully restricted');
    recommendations.push('Re-run setup to install guarded shell');
  }

  // Cross-target process validation: verify each target's processes run under its own users
  if (hasTargets) {
    const allTargetUsers = new Set(sandboxUsers);
    let hasCrossTargetIssue = false;

    for (const target of knownTargets) {
      const patterns = target.processPatterns ?? [target.targetName];
      const targetProcesses = findProcessesByPatterns(patterns);
      const targetUserSet = new Set(target.users);

      for (const proc of targetProcesses) {
        // Skip processes under non-sandbox users — already caught by unIsolatedProcesses check above
        if (!allTargetUsers.has(proc.user)) continue;
        // Flag processes running under a different target's sandbox user
        if (!targetUserSet.has(proc.user)) {
          const ownerTarget = knownTargets.find((t) => t.users.includes(proc.user));
          warnings.push(
            `Cross-target: "${target.targetName}" process (PID ${proc.pid}) running under ` +
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
