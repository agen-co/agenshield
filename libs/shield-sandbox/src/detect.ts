/**
 * OpenClaw installation detector
 *
 * Detects existing OpenClaw installations (npm or git method)
 * and gathers information needed for isolation.
 *
 * This module is in shield-sandbox so it can be reused by both
 * the CLI wizard and the daemon for status checks.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Resolve home directory, accounting for sudo.
 * Under sudo, os.homedir() returns /var/root; use SUDO_USER to find the real user.
 */
function getHome(): string {
  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser) {
    const userHome = path.join('/Users', sudoUser);
    if (fs.existsSync(userHome)) return userHome;
  }
  return os.homedir();
}

const HOME = getHome();

// ============================================================================
// Types
// ============================================================================

export type InstallMethod = 'npm' | 'git' | 'unknown';

export interface OpenClawInstallation {
  /** Whether OpenClaw is installed */
  found: boolean;
  /** Installation method */
  method: InstallMethod;
  /** Path to the main package/source directory */
  packagePath?: string;
  /** Path to the openclaw binary/wrapper */
  binaryPath?: string;
  /** Path to the config directory (~/.openclaw/) */
  configPath?: string;
  /** Installed version */
  version?: string;
  /** Path to the git repo (for git installs) */
  gitRepoPath?: string;
}

export interface DetectionResult {
  installation: OpenClawInstallation;
  errors: string[];
  warnings: string[];
}

export interface PrerequisitesResult {
  ok: boolean;
  missing: string[];
}

// SecurityStatus is exported from ./security.ts to avoid duplication

// ============================================================================
// Utilities
// ============================================================================

/**
 * Execute a command and return stdout, or null if it fails
 */
function execSafe(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if a path exists and is accessible
 */
function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// npm Detection
// ============================================================================

/**
 * Get npm global root directory
 */
function getNpmGlobalRoot(): string | null {
  return execSafe('npm root -g');
}

/**
 * Get npm global bin directory
 */
function getNpmGlobalBin(): string | null {
  return execSafe('npm prefix -g')?.concat('/bin') ?? null;
}

/**
 * Detect npm-based installation
 */
function detectNpmInstall(): Partial<OpenClawInstallation> {
  const npmRoot = getNpmGlobalRoot();
  if (!npmRoot) return { found: false, method: 'npm' };

  const openclawPkg = path.join(npmRoot, 'openclaw');
  if (!pathExists(openclawPkg)) return { found: false, method: 'npm' };

  // Try to get version from package.json
  let version: string | undefined;
  const pkgJsonPath = path.join(openclawPkg, 'package.json');
  if (pathExists(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      version = pkg.version;
    } catch {
      // Ignore parse errors
    }
  }

  // Find the binary
  const npmBin = getNpmGlobalBin();
  const binaryPath = npmBin ? path.join(npmBin, 'openclaw') : undefined;

  return {
    found: true,
    method: 'npm',
    packagePath: openclawPkg,
    binaryPath: binaryPath && pathExists(binaryPath) ? binaryPath : undefined,
    version,
  };
}

// ============================================================================
// Git Detection
// ============================================================================

/**
 * Detect git-based installation
 */
function detectGitInstall(): Partial<OpenClawInstallation> {
  // Check common git install locations
  const possiblePaths = [
    path.join(HOME, 'openclaw'),
    path.join(HOME, '.openclaw-src'),
    path.join(HOME, 'code', 'openclaw'),
    path.join(HOME, 'src', 'openclaw'),
  ];

  for (const repoPath of possiblePaths) {
    if (!pathExists(repoPath)) continue;

    // Check if it's a git repo with openclaw
    const gitDir = path.join(repoPath, '.git');
    const pkgJson = path.join(repoPath, 'package.json');

    if (pathExists(gitDir) && pathExists(pkgJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
        if (pkg.name === 'openclaw' || pkg.name?.includes('openclaw')) {
          // Check for the wrapper script
          const wrapperPath = path.join(HOME, '.local', 'bin', 'openclaw');

          return {
            found: true,
            method: 'git',
            packagePath: repoPath,
            gitRepoPath: repoPath,
            binaryPath: pathExists(wrapperPath) ? wrapperPath : undefined,
            version: pkg.version,
          };
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Check for wrapper script pointing to a git install
  const wrapperPath = path.join(HOME, '.local', 'bin', 'openclaw');
  if (pathExists(wrapperPath)) {
    try {
      const content = fs.readFileSync(wrapperPath, 'utf-8');
      // Parse the wrapper to find the repo path
      const match = content.match(/exec node "([^"]+)\/dist\/entry\.js"/);
      if (match) {
        const repoPath = match[1];
        if (pathExists(repoPath)) {
          const pkgJson = path.join(repoPath, 'package.json');
          let version: string | undefined;
          if (pathExists(pkgJson)) {
            try {
              version = JSON.parse(fs.readFileSync(pkgJson, 'utf-8')).version;
            } catch {
              // Ignore
            }
          }

          return {
            found: true,
            method: 'git',
            packagePath: repoPath,
            gitRepoPath: repoPath,
            binaryPath: wrapperPath,
            version,
          };
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return { found: false, method: 'git' };
}

// ============================================================================
// Config Detection
// ============================================================================

/**
 * Detect OpenClaw config directory
 */
function detectConfigDir(): string | undefined {
  const configPath = path.join(HOME, '.openclaw');
  return pathExists(configPath) ? configPath : undefined;
}

/**
 * Get OpenClaw version via CLI
 */
function getVersionViaCli(): string | null {
  return execSafe('openclaw --version');
}

// ============================================================================
// Main Detection
// ============================================================================

/**
 * Detect OpenClaw installation
 */
export function detectOpenClaw(): DetectionResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Try npm install first
  const npmResult = detectNpmInstall();

  // Try git install
  const gitResult = detectGitInstall();

  // Determine which one to use
  let installation: OpenClawInstallation;

  if (npmResult.found && gitResult.found) {
    // Both found - warn user, prefer npm
    warnings.push(
      'Both npm and git installations found. Using npm installation. ' +
        'Consider removing one to avoid conflicts.'
    );
    installation = {
      ...npmResult,
      configPath: detectConfigDir(),
    } as OpenClawInstallation;
  } else if (npmResult.found) {
    installation = {
      ...npmResult,
      configPath: detectConfigDir(),
    } as OpenClawInstallation;
  } else if (gitResult.found) {
    installation = {
      ...gitResult,
      configPath: detectConfigDir(),
    } as OpenClawInstallation;
  } else {
    installation = {
      found: false,
      method: 'unknown',
    };
  }

  // Try to get version via CLI if not found
  if (installation.found && !installation.version) {
    const cliVersion = getVersionViaCli();
    if (cliVersion) {
      installation.version = cliVersion;
    }
  }

  // Validate the installation
  if (installation.found) {
    if (!installation.packagePath || !pathExists(installation.packagePath)) {
      errors.push('Package path not found or inaccessible');
    }
    if (!installation.binaryPath || !pathExists(installation.binaryPath)) {
      warnings.push('Binary path not found - may need to add to PATH');
    }
  }

  return { installation, errors, warnings };
}

// ============================================================================
// Prerequisites
// ============================================================================

/**
 * Check prerequisites for isolation
 */
export function checkPrerequisites(): PrerequisitesResult {
  const missing: string[] = [];

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorVersion < 22) {
    missing.push(`Node.js 22+ required (current: ${nodeVersion})`);
  }

  // Check if running on macOS
  if (process.platform !== 'darwin') {
    missing.push('macOS required (current platform not supported yet)');
  }

  // Check if dscl is available (for user creation)
  if (!execSafe('which dscl')) {
    missing.push('dscl command not found (required for user management)');
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

// Security status is exported from ./security.ts to avoid duplication
// Import checkSecurityStatus from there if needed
