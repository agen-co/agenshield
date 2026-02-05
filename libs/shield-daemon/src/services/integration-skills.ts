/**
 * Integration Skills Service
 *
 * Provisions the single `agentlink-secure-integrations` skill into
 * the user's skills directory when any integration is connected.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BUILTIN_SKILLS_DIR } from '@agenshield/skills';
import { getSkillsDir, addToApprovedList, removeFromApprovedList } from '../watchers/skills';

const AGENTLINK_SKILL_NAME = 'agentlink-secure-integrations';

/**
 * Copy a directory recursively (files and subdirectories).
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Provision the `agentlink-secure-integrations` skill into the user's
 * skills directory.  Call this when ANY integration is connected.
 *
 * Returns `{ installed: true }` if newly copied, `{ installed: false }` if
 * already present, or throws on unexpected errors.
 */
export async function provisionAgentLinkSkill(): Promise<{ installed: boolean }> {
  const skillsDir = getSkillsDir();
  if (!skillsDir) {
    console.warn('[IntegrationSkills] Skills directory not configured — skipping provision');
    return { installed: false };
  }

  const destDir = path.join(skillsDir, AGENTLINK_SKILL_NAME);
  const srcDir = path.join(BUILTIN_SKILLS_DIR, AGENTLINK_SKILL_NAME);

  // Already provisioned — nothing to do
  if (fs.existsSync(destDir)) {
    return { installed: false };
  }

  try {
    // Pre-approve to prevent race with watcher quarantining
    addToApprovedList(AGENTLINK_SKILL_NAME);

    // Copy entire skill directory (SKILL.md + bin/ + config/)
    copyDirSync(srcDir, destDir);

    console.log(`[IntegrationSkills] Installed "${AGENTLINK_SKILL_NAME}"`);
    return { installed: true };
  } catch (err) {
    // Cleanup on failure
    console.error(`[IntegrationSkills] Failed to install "${AGENTLINK_SKILL_NAME}":`, (err as Error).message);
    try {
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
      removeFromApprovedList(AGENTLINK_SKILL_NAME);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}
