/**
 * Skill Installation Handler
 *
 * Handles skill installation and uninstallation operations.
 * These operations are socket-only due to privileged file operations.
 */

import * as fs from 'node:fs/promises';
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
 * Create wrapper script content for a skill.
 * Routes through shield-client for policy-enforced execution.
 */
function createWrapperContent(slug: string): string {
  return `#!/bin/bash
# ${slug} skill wrapper - policy-enforced execution
# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi
exec /opt/agenshield/bin/shield-client skill run "${slug}" "$@"
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
  const warnings: string[] = [];

  try {
    const {
      slug,
      files,
      createWrapper = false,
      agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent',
      socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default',
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

    const skillsDir = path.join(agentHome, '.openclaw', 'workspace', 'skills');
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

    // Lock down skill directory: read+traverse for everyone, no group/other write
    // Ownership is already correct: broker user + socketGroup (via setgid on parent)
    try {
      execSync(`chmod -R a+rX,go-w "${skillDir}"`, { stdio: 'pipe' });
    } catch (err) {
      const msg = `chmod on skill dir failed: ${(err as Error).message}`;
      console.warn(`[SkillInstall] ${msg}`);
      warnings.push(msg);
    }

    // Note: openclaw.json is managed by the daemon (running as root) via
    // addSkillEntry() + syncOpenClawFromPolicies(). The broker only handles
    // filesystem operations (skill files + wrapper).

    // Create wrapper script
    let wrapperPath: string | undefined;
    if (createWrapper) {
      wrapperPath = path.join(binDir, slug);

      // Ensure bin directory exists
      await fs.mkdir(binDir, { recursive: true });

      // Write wrapper
      const wrapperContent = createWrapperContent(slug);
      await fs.writeFile(wrapperPath, wrapperContent, { mode: 0o755 });

      // Wrapper is already 755 from writeFile above and owned by broker:socketGroup
      // (setgid on bin/ ensures correct group)
    }

    return {
      success: true,
      data: {
        installed: true,
        skillDir,
        wrapperPath,
        filesWritten,
        warnings: warnings.length > 0 ? warnings : undefined,
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

    const skillsDir = path.join(agentHome, '.openclaw', 'workspace', 'skills');
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

    // Note: openclaw.json entry removal is handled by the daemon via
    // removeSkillEntry() + syncOpenClawFromPolicies().

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
