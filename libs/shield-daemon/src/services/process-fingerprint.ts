/**
 * Process Fingerprint Module
 *
 * Provides binary identity resolution for anti-rename detection.
 * Three-layer pipeline:
 *   Layer A — Symlink resolution: follow renamed symlinks back to original
 *   Layer B — package.json lookup: walk up to find npm package name
 *   Layer C — SHA256 hash DB: cloud-managed registry of known binary hashes
 *
 * Only invoked for processes that weren't caught by standard name matching,
 * so there's zero overhead for the common case.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/** Standard directories to search for real binaries (mirrors command-sync.ts) */
export const DEFAULT_BIN_SEARCH_DIRS = [
  '/usr/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/sbin',
  '/usr/local/sbin',
  '/opt/homebrew/sbin',
];

// ─── Types ──────────────────────────────────────────────────

export interface ProcessFingerprint {
  /** Additional candidate names for pattern matching */
  candidateNames: string[];
  /** Resolved real path of the binary (after symlink resolution), null if not found */
  resolvedPath: string | null;
  /** npm package name from package.json, if found */
  npmPackageName: string | null;
  /** SHA256 of the binary file, if computed */
  sha256: string | null;
  /** How the identity was resolved */
  resolvedVia: 'symlink' | 'package-json' | 'hash-db' | null;
}

export interface FingerprintOptions {
  /** Binary search directories (defaults to BIN_SEARCH_DIRS) */
  searchDirs?: string[];
  /** SHA256 lookup function (injected for testability) */
  hashLookup?: (sha256: string) => string | null;
  /** Per-scan cache to avoid re-reading filesystem */
  cache?: Map<string, ProcessFingerprint>;
}

/** Max file size for SHA256 hashing (200MB) */
const MAX_HASH_FILE_SIZE = 200 * 1024 * 1024;

/** Max directory depth to walk up looking for package.json */
const MAX_PACKAGE_WALK_DEPTH = 10;

// ─── Public API ─────────────────────────────────────────────

/**
 * Main entry point — resolve the true identity of a process binary.
 *
 * Pipeline:
 *   1. Extract binary token from command
 *   2. Find binary file: full path or search BIN_SEARCH_DIRS
 *   3. realpathSync — resolve symlink chain to actual file
 *   4. resolveNpmPackage — walk up to find package.json name
 *   5. Build candidateNames from npm package name + path segments
 *   6. If no candidates yet: SHA256 hash → lookup in DB
 *   7. Return fingerprint
 */
export function fingerprintProcess(
  command: string,
  opts?: FingerprintOptions,
): ProcessFingerprint {
  const binaryToken = extractBinaryToken(command);
  if (!binaryToken) {
    return emptyFingerprint();
  }

  // Check cache
  const cache = opts?.cache;
  if (cache?.has(binaryToken)) {
    return cache.get(binaryToken)!;
  }

  const searchDirs = opts?.searchDirs ?? DEFAULT_BIN_SEARCH_DIRS;

  // Find the binary file on disk
  let binaryPath: string | null = null;
  if (path.isAbsolute(binaryToken)) {
    binaryPath = binaryToken;
  } else {
    binaryPath = findBinaryPath(binaryToken, searchDirs);
  }

  if (!binaryPath) {
    const result = emptyFingerprint();
    cache?.set(binaryToken, result);
    return result;
  }

  // Layer A: Symlink resolution
  let resolvedPath: string | null = null;
  try {
    resolvedPath = fs.realpathSync(binaryPath);
  } catch {
    resolvedPath = binaryPath;
  }

  const candidateNames: string[] = [];
  let resolvedVia: ProcessFingerprint['resolvedVia'] = null;
  let npmPackageName: string | null = null;

  // If symlink resolved to a different path, extract names from the resolved path
  if (resolvedPath !== binaryPath) {
    const symCandidates = extractCandidatesFromPath(resolvedPath);
    if (symCandidates.length > 0) {
      candidateNames.push(...symCandidates);
      resolvedVia = 'symlink';
    }
  }

  // Layer B: package.json lookup (on the resolved path)
  if (resolvedPath) {
    const pkg = resolveNpmPackage(resolvedPath);
    if (pkg) {
      npmPackageName = pkg.name;
      if (!candidateNames.includes(pkg.name)) {
        candidateNames.push(pkg.name);
      }
      // If we didn't already have candidates from symlink, mark resolution source
      if (!resolvedVia) {
        resolvedVia = 'package-json';
      }
    }
  }

  // Layer C: SHA256 hash DB lookup
  let sha256: string | null = null;
  if (candidateNames.length === 0 && resolvedPath && opts?.hashLookup) {
    sha256 = computeFileHash(resolvedPath);
    if (sha256) {
      const packageName = opts.hashLookup(sha256);
      if (packageName) {
        candidateNames.push(packageName);
        resolvedVia = 'hash-db';
      }
    }
  }

  const result: ProcessFingerprint = {
    candidateNames,
    resolvedPath,
    npmPackageName,
    sha256,
    resolvedVia,
  };

  cache?.set(binaryToken, result);
  return result;
}

/**
 * Walk up from filePath directory-by-directory to find package.json with a name field.
 * Skips package.json without a name (e.g., workspace root markers).
 * Max depth: 10 levels.
 */
export function resolveNpmPackage(filePath: string): { name: string; dir: string } | null {
  let dir = path.dirname(filePath);

  for (let i = 0; i < MAX_PACKAGE_WALK_DEPTH; i++) {
    const pkgPath = path.join(dir, 'package.json');

    try {
      if (fs.existsSync(pkgPath)) {
        const content = fs.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(content) as { name?: string };
        if (pkg.name && typeof pkg.name === 'string') {
          // Strip npm scope prefix for matching (e.g., @org/openclaw → openclaw)
          const name = pkg.name.startsWith('@') && pkg.name.includes('/')
            ? pkg.name.split('/')[1]
            : pkg.name;
          return { name, dir };
        }
      }
    } catch {
      // Can't read or parse — skip this level
    }

    const parentDir = path.dirname(dir);
    if (parentDir === dir) break; // Reached filesystem root
    dir = parentDir;
  }

  return null;
}

/**
 * Compute SHA256 hash of a file.
 * Returns null on read error or if file exceeds MAX_HASH_FILE_SIZE.
 */
export function computeFileHash(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_HASH_FILE_SIZE) return null;
    if (!stat.isFile()) return null;

    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Search for a binary by name in the given directories.
 * Returns the full path if found and executable, null otherwise.
 */
export function findBinaryPath(binaryName: string, searchDirs: string[]): string | null {
  for (const dir of searchDirs) {
    const candidate = path.join(dir, binaryName);
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        // Accept files and symlinks (stat follows symlinks)
        if (stat.isFile() && (stat.mode & 0o111) !== 0) {
          return candidate;
        }
      }
    } catch {
      // skip unreadable
    }
  }
  return null;
}

// ─── Internal helpers ──────────────────────────────────────

/**
 * Extract the binary token (first non-flag argument) from a process command string.
 */
function extractBinaryToken(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Split on whitespace, take the first token
  const firstToken = trimmed.split(/\s+/)[0];
  if (!firstToken) return null;

  // If it's a full path, return as-is for path-based lookup
  if (path.isAbsolute(firstToken)) return firstToken;

  // Return basename (strip any path prefix)
  return path.basename(firstToken);
}

/**
 * Extract candidate package names from a resolved file path.
 * Looks for patterns like node_modules/<package>/... or meaningful directory names.
 */
function extractCandidatesFromPath(filePath: string): string[] {
  const candidates: string[] = [];
  const segments = filePath.split(path.sep);

  // Look for node_modules/<package> pattern
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === 'node_modules') {
      const next = segments[i + 1];
      if (next.startsWith('@') && i + 2 < segments.length) {
        // Scoped package: @org/package → package
        candidates.push(segments[i + 2]);
      } else {
        candidates.push(next);
      }
      break;
    }
  }

  // Look for site-packages/<package> pattern (Python)
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === 'site-packages') {
      candidates.push(segments[i + 1]);
      break;
    }
  }

  return candidates;
}

function emptyFingerprint(): ProcessFingerprint {
  return {
    candidateNames: [],
    resolvedPath: null,
    npmPackageName: null,
    sha256: null,
    resolvedVia: null,
  };
}
