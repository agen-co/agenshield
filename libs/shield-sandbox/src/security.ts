/**
 * Security status checks for the sandbox
 */

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { userExists } from './macos';
import { GUARDED_SHELL_PATH } from './guarded-shell';

/** Users recognized as valid sandbox users */
const SANDBOX_USERS = ['openclaw', 'ash_default_agent'];

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

/**
 * Check if OpenClaw processes are running and get their users
 */
function getOpenClawProcesses(): Array<{ pid: string; user: string; command: string }> {
  const output = execSafe("ps aux | grep -E '[o]penclaw|[c]lawbot' | grep -v grep");
  if (!output) return [];

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
 * Options for security status checks
 */
export interface SecurityCheckOptions {
  /** Environment to scan for secrets (defaults to process.env) */
  env?: Record<string, string | undefined>;
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

  // Check sandbox user
  const sandboxUserExists = SANDBOX_USERS.some((u) => userExists(u));
  const guardedShellInstalled = isGuardedShellInstalled();

  // Check if OpenClaw is running in sandbox
  const processes = getOpenClawProcesses();
  const isolatedProcesses = processes.filter((p) => SANDBOX_USERS.includes(p.user));
  const unIsolatedProcesses = processes.filter((p) => !SANDBOX_USERS.includes(p.user));
  const isIsolated = sandboxUserExists && unIsolatedProcesses.length === 0;

  // Check exposed secrets
  const exposedSecrets = checkExposedSecrets(options?.env);

  // Build warnings and recommendations
  if (runningAsRoot) {
    critical.push('DANGER: Running as root! OpenClaw should never run as root.');
    recommendations.push('Run AgenShield setup to isolate OpenClaw in unprivileged sandbox');
  }

  if (!sandboxUserExists) {
    warnings.push('No sandbox user found (checked: ' + SANDBOX_USERS.join(', ') + ')');
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
