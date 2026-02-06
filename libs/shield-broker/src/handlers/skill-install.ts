/**
 * Skill Installation Handler
 *
 * Handles skill installation and uninstallation operations.
 * These operations are socket-only due to privileged file operations.
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  HandlerContext,
  HandlerResult,
  SkillInstallParams,
  SkillInstallResult,
  SkillUninstallParams,
  SkillUninstallResult,
} from '../types.js';
import type { HandlerDependencies } from './types.js';

/**
 * Validate slug to prevent path traversal
 */
function isValidSlug(slug: string): boolean {
  // Only allow alphanumeric, dash, underscore
  // Must not start with dot or contain path separators
  const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
  return validPattern.test(slug) && !slug.includes('..') && !slug.includes('/');
}

/**
 * Create wrapper script content for a skill
 */
function createWrapperContent(slug: string, skillDir: string): string {
  return `#!/bin/bash
# Auto-generated wrapper for skill: ${slug}
# This script runs the skill via openclaw-pkg

set -e

SKILL_DIR="${skillDir}"

# Check if skill directory exists
if [ ! -d "$SKILL_DIR" ]; then
  echo "Error: Skill directory not found: $SKILL_DIR" >&2
  exit 1
fi

# Find and execute the main skill file
if [ -f "$SKILL_DIR/skill.md" ]; then
  exec openclaw-pkg run "$SKILL_DIR/skill.md" "$@"
elif [ -f "$SKILL_DIR/index.js" ]; then
  exec node "$SKILL_DIR/index.js" "$@"
elif [ -f "$SKILL_DIR/main.py" ]; then
  exec python3 "$SKILL_DIR/main.py" "$@"
else
  echo "Error: No entry point found in $SKILL_DIR" >&2
  exit 1
fi
`;
}

/**
 * Handle skill installation
 */
export async function handleSkillInstall(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<SkillInstallResult>> {
  const startTime = Date.now();

  try {
    const {
      slug,
      files,
      createWrapper = true,
      agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent',
      socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'clawshield',
    } = params as unknown as SkillInstallParams;

    // Validate slug
    if (!slug || !isValidSlug(slug)) {
      return {
        success: false,
        error: { code: 1003, message: `Invalid skill slug: ${slug}. Must be alphanumeric with dashes/underscores.` },
      };
    }

    // Validate files
    if (!Array.isArray(files) || files.length === 0) {
      return {
        success: false,
        error: { code: 1003, message: 'Files array is required and must not be empty' },
      };
    }

    // Validate each file
    for (const file of files) {
      if (!file.name || typeof file.name !== 'string') {
        return {
          success: false,
          error: { code: 1003, message: 'Each file must have a name' },
        };
      }
      // Prevent path traversal in file names
      if (file.name.includes('..') || file.name.startsWith('/')) {
        return {
          success: false,
          error: { code: 1003, message: `Invalid file name: ${file.name}` },
        };
      }
    }

    const skillsDir = path.join(agentHome, '.openclaw', 'skills');
    const skillDir = path.join(skillsDir, slug);
    const binDir = path.join(agentHome, 'bin');

    // Create skill directory
    await fs.mkdir(skillDir, { recursive: true });

    // Write files
    let filesWritten = 0;
    for (const file of files) {
      const filePath = path.join(skillDir, file.name);
      const fileDir = path.dirname(filePath);

      // Ensure parent directory exists
      await fs.mkdir(fileDir, { recursive: true });

      // Decode content if base64
      const content = file.base64
        ? Buffer.from(file.content, 'base64')
        : file.content;

      // Write file with optional mode
      await fs.writeFile(filePath, content, { mode: file.mode });
      filesWritten++;
    }

    // Set ownership on skill directory
    try {
      execSync(`chown -R root:${socketGroup} "${skillDir}"`, { stdio: 'pipe' });
      execSync(`chmod -R a+rX,go-w "${skillDir}"`, { stdio: 'pipe' });
    } catch (err) {
      // Log but don't fail - ownership setting may fail in dev environment
      console.warn(`[SkillInstall] chown failed (may be expected in dev): ${(err as Error).message}`);
    }

    // Update openclaw.json with skill entry (broker has write access to .openclaw)
    const openclawConfigPath = path.join(agentHome, '.openclaw', 'openclaw.json');
    try {
      let openclawConfig: Record<string, unknown> = {};
      try {
        const raw = fsSync.readFileSync(openclawConfigPath, 'utf-8');
        openclawConfig = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // File doesn't exist or is invalid — start fresh
      }
      if (!openclawConfig.skills) {
        openclawConfig.skills = {};
      }
      const skills = openclawConfig.skills as Record<string, unknown>;
      if (!skills.entries) {
        skills.entries = {};
      }
      (skills.entries as Record<string, unknown>)[slug] = { enabled: true };
      fsSync.writeFileSync(openclawConfigPath, JSON.stringify(openclawConfig, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[SkillInstall] openclaw.json update failed: ${(err as Error).message}`);
    }

    // Create wrapper script
    let wrapperPath: string | undefined;
    if (createWrapper) {
      wrapperPath = path.join(binDir, slug);

      // Ensure bin directory exists
      await fs.mkdir(binDir, { recursive: true });

      // Write wrapper
      const wrapperContent = createWrapperContent(slug, skillDir);
      await fs.writeFile(wrapperPath, wrapperContent, { mode: 0o755 });

      // Set ownership on wrapper
      try {
        execSync(`chown root:${socketGroup} "${wrapperPath}"`, { stdio: 'pipe' });
        execSync(`chmod 755 "${wrapperPath}"`, { stdio: 'pipe' });
      } catch (err) {
        console.warn(`[SkillInstall] wrapper chown failed: ${(err as Error).message}`);
      }
    }

    return {
      success: true,
      data: {
        installed: true,
        skillDir,
        wrapperPath,
        filesWritten,
      },
      audit: {
        duration: Date.now() - startTime,
        bytesTransferred: files.reduce((sum, f) => sum + (f.content?.length || 0), 0),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 1005, message: `Skill installation failed: ${(error as Error).message}` },
    };
  }
}

/**
 * Handle skill uninstallation
 */
export async function handleSkillUninstall(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<SkillUninstallResult>> {
  const startTime = Date.now();

  try {
    const {
      slug,
      agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent',
      removeWrapper = true,
    } = params as unknown as SkillUninstallParams;

    // Validate slug
    if (!slug || !isValidSlug(slug)) {
      return {
        success: false,
        error: { code: 1003, message: `Invalid skill slug: ${slug}` },
      };
    }

    const skillsDir = path.join(agentHome, '.openclaw', 'skills');
    const skillDir = path.join(skillsDir, slug);
    const binDir = path.join(agentHome, 'bin');
    const wrapperPath = path.join(binDir, slug);

    // Check if skill directory exists
    let skillExists = false;
    try {
      await fs.access(skillDir);
      skillExists = true;
    } catch {
      // Skill doesn't exist
    }

    // Remove skill directory
    if (skillExists) {
      await fs.rm(skillDir, { recursive: true, force: true });
    }

    // Remove skill entry from openclaw.json
    const openclawConfigPath = path.join(agentHome, '.openclaw', 'openclaw.json');
    try {
      const raw = fsSync.readFileSync(openclawConfigPath, 'utf-8');
      const openclawConfig = JSON.parse(raw) as Record<string, unknown>;
      const skills = openclawConfig.skills as Record<string, unknown> | undefined;
      const entries = skills?.entries as Record<string, unknown> | undefined;
      if (entries?.[slug]) {
        delete entries[slug];
        fsSync.writeFileSync(openclawConfigPath, JSON.stringify(openclawConfig, null, 2), 'utf-8');
      }
    } catch {
      // Best-effort removal
    }

    // Remove wrapper if requested
    let wrapperRemoved = false;
    if (removeWrapper) {
      try {
        await fs.access(wrapperPath);
        await fs.unlink(wrapperPath);
        wrapperRemoved = true;
      } catch {
        // Wrapper doesn't exist or can't be removed
      }
    }

    return {
      success: true,
      data: {
        uninstalled: true,
        skillDir,
        wrapperRemoved,
      },
      audit: {
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 1005, message: `Skill uninstallation failed: ${(error as Error).message}` },
    };
  }
}
