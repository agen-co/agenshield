/**
 * Integration Skills Service
 *
 * Provisions the single `agenco-secure-integrations` skill into
 * the user's skills directory when any integration is connected.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BUILTIN_SKILLS_DIR } from '@agenshield/skills';
import { getSkillsDir, addToApprovedList, removeFromApprovedList } from '../watchers/skills';

const AGENCO_SKILL_NAME = 'agenco-secure-integrations';

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
 * Provision the `agenco-secure-integrations` skill into the user's
 * skills directory.  Call this when ANY integration is connected.
 *
 * Returns `{ installed: true }` if newly copied, `{ installed: false }` if
 * already present, or throws on unexpected errors.
 */
export async function provisionAgenCoSkill(): Promise<{ installed: boolean }> {
  const skillsDir = getSkillsDir();
  if (!skillsDir) {
    console.warn('[IntegrationSkills] Skills directory not configured — skipping provision');
    return { installed: false };
  }

  const destDir = path.join(skillsDir, AGENCO_SKILL_NAME);
  const srcDir = path.join(BUILTIN_SKILLS_DIR, AGENCO_SKILL_NAME);

  // Already provisioned — nothing to do
  if (fs.existsSync(destDir)) {
    return { installed: false };
  }

  try {
    // Pre-approve to prevent race with watcher quarantining
    addToApprovedList(AGENCO_SKILL_NAME);

    // Copy entire skill directory (SKILL.md + bin/ + config/)
    copyDirSync(srcDir, destDir);

    console.log(`[IntegrationSkills] Installed "${AGENCO_SKILL_NAME}"`);
    return { installed: true };
  } catch (err) {
    // Cleanup on failure
    console.error(`[IntegrationSkills] Failed to install "${AGENCO_SKILL_NAME}":`, (err as Error).message);
    try {
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
      removeFromApprovedList(AGENCO_SKILL_NAME);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}

/**
 * Provision an integration-specific documentation skill into the user's
 * skills directory.  Call this when a specific integration is connected.
 *
 * Graceful no-op if the skill folder doesn't exist (integration not in marketplace).
 */
export async function provisionIntegrationSkill(integrationSlug: string): Promise<{ installed: boolean }> {
  const skillsDir = getSkillsDir();
  if (!skillsDir) {
    console.warn('[IntegrationSkills] Skills directory not configured — skipping provision');
    return { installed: false };
  }

  const skillName = `integration-${integrationSlug}`;
  const destDir = path.join(skillsDir, skillName);
  const srcDir = path.join(BUILTIN_SKILLS_DIR, skillName);

  // Already provisioned — nothing to do
  if (fs.existsSync(destDir)) {
    return { installed: false };
  }

  // Graceful no-op if skill folder doesn't exist (not in marketplace)
  if (!fs.existsSync(srcDir)) {
    return { installed: false };
  }

  try {
    addToApprovedList(skillName);
    copyDirSync(srcDir, destDir);
    console.log(`[IntegrationSkills] Installed "${skillName}"`);
    return { installed: true };
  } catch (err) {
    console.error(`[IntegrationSkills] Failed to install "${skillName}":`, (err as Error).message);
    try {
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
      removeFromApprovedList(skillName);
    } catch {
      // Best-effort cleanup
    }
    throw err;
  }
}
