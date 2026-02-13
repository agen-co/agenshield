/**
 * Sync utilities
 */

import * as crypto from 'node:crypto';
import type { SourceSkillFile } from '@agenshield/ipc';

/**
 * Compute SHA-256 from an array of SourceSkillFile objects.
 * Files are sorted by name for determinism, matching the on-disk hash logic
 * in watchers/skills.ts computeSkillHash().
 */
export function computeSkillDefinitionSha(files: SourceSkillFile[]): string {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const hash = crypto.createHash('sha256');
  for (const file of sorted) {
    hash.update(file.name);
    hash.update(file.content);
  }
  return hash.digest('hex');
}
