/**
 * Filesystem pattern matching utilities.
 */

import { globToRegex } from './url';

/**
 * Match a filesystem target against a glob pattern.
 *
 * - Directory patterns ending with '/' automatically match all contents (appends **)
 * - Uses globToRegex for pattern compilation
 */
export function matchFilesystemPattern(pattern: string, target: string): boolean {
  let fsPattern = pattern;
  if (fsPattern.endsWith('/')) {
    fsPattern = fsPattern + '**';
  }
  const regex = globToRegex(fsPattern);
  return regex.test(target);
}
