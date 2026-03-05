/**
 * Sensitive file scanner for workspace directories.
 *
 * Walks workspace directories (up to a configurable depth) and identifies
 * files that likely contain secrets, credentials, or private keys.
 * Used during workspace grant to proactively deny-ACL sensitive files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** A sensitive file detection result */
export interface SensitiveFile {
  path: string;
  reason: string;
}

/** Well-known filenames that typically contain secrets or credentials */
const SENSITIVE_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.staging',
  '.env.test',
  'credentials.json',
  'service-account.json',
  'id_rsa',
  'id_ed25519',
  '.npmrc',
  '.pypirc',
  '.netrc',
]);

/** File extension patterns that indicate private keys or certificates */
const SENSITIVE_EXTENSIONS: readonly RegExp[] = [
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
];

/** Directories to skip when scanning */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  '.hg',
  '__pycache__',
  '.tox',
  '.venv',
  'venv',
]);

/**
 * Scan a workspace directory for files that likely contain secrets.
 *
 * @param workspacePath  Root directory to scan
 * @param maxDepth       Maximum recursion depth (default 4)
 * @returns List of detected sensitive files with reasons
 */
export function scanForSensitiveFiles(
  workspacePath: string,
  maxDepth = 4,
): SensitiveFile[] {
  const results: SensitiveFile[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath, depth + 1);
        }
        continue;
      }

      // Check known filenames
      if (SENSITIVE_FILENAMES.has(entry.name)) {
        results.push({ path: fullPath, reason: `sensitive filename: ${entry.name}` });
        continue;
      }

      // Check extension patterns
      for (const re of SENSITIVE_EXTENSIONS) {
        if (re.test(entry.name)) {
          results.push({ path: fullPath, reason: `sensitive extension: ${entry.name}` });
          break;
        }
      }
    }
  }

  walk(workspacePath, 0);
  return results;
}
