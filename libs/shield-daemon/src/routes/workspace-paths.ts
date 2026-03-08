/**
 * Workspace path management routes
 *
 * Provides check and grant endpoints for the router wrapper
 * to validate and register allowed workspace directories.
 */

import type { FastifyInstance } from 'fastify';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { getStorage } from '@agenshield/storage';
import { addUserAcl, getAncestorsNeedingTraversal, removeOrphanedAcls, removeUserAcl } from '../acl';
import { scanForSensitiveFiles } from '../services/sensitive-file-scanner';
import { emitEvent } from '../events/emitter';
import { getSystemExecutor } from '../workers/system-command';
import { getLogger } from '../logger';

export async function workspacePathsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Check if a directory path is allowed for any profile.
   * Used by the router wrapper to validate CWD before launching.
   */
  app.get('/workspace-paths/check', async (request) => {
    const query = request.query as { path?: string };
    const checkPath = query.path;

    if (!checkPath) {
      return { allowed: false };
    }

    const resolved = path.resolve(checkPath);
    const storage = getStorage();
    const profiles = storage.profiles.getByType('target');

    for (const profile of profiles) {
      // Always allowed: agentHomeDir and its subdirectories
      if (profile.agentHomeDir && resolved.startsWith(profile.agentHomeDir)) {
        return { allowed: true, profileId: profile.id };
      }

      // Check workspace paths
      const workspacePaths = profile.workspacePaths ?? [];
      for (const ws of workspacePaths) {
        if (resolved === ws || resolved.startsWith(ws + '/')) {
          return { allowed: true, profileId: profile.id };
        }
      }
    }

    return { allowed: false };
  });

  /**
   * Grant access to a workspace directory by adding it to a profile.
   * Used by the router wrapper when the user approves a new directory.
   */
  app.post('/workspace-paths/grant', async (request, reply) => {
    const body = request.body as { path?: string; profileId?: string; agentUser?: string };
    const grantPath = body.path;

    if (!grantPath) {
      return reply.status(400).send({
        success: false,
        error: { message: 'path is required', statusCode: 400 },
      });
    }

    const resolved = path.resolve(grantPath);
    const storage = getStorage();

    // If profileId given, use that profile; otherwise pick the first target profile
    let profileId = body.profileId;
    let agentUsername = body.agentUser;
    if (!profileId) {
      const targets = storage.profiles.getByType('target');
      if (targets.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { message: 'No target profiles found', statusCode: 404 },
        });
      }
      profileId = targets[0].id;
      if (!agentUsername) {
        agentUsername = targets[0].agentUsername;
      }
    }

    const updated = storage.profiles.addWorkspacePath(profileId, resolved);
    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: { message: `Profile ${profileId} not found`, statusCode: 404 },
      });
    }

    // Apply macOS ACLs so the agent user can actually access the directory
    const userName = agentUsername ?? updated.agentUsername;
    if (userName) {
      applyWorkspacePathAcls(resolved, userName, app.log);

      // Verify ACLs actually took effect
      try {
        execSync(
          `sudo -n -u ${JSON.stringify(userName)} test -r ${JSON.stringify(resolved)} -a -x ${JSON.stringify(resolved)} -a -w ${JSON.stringify(resolved)}`,
          { timeout: 5_000, stdio: 'pipe' },
        );
      } catch {
        app.log.warn(`[workspace-paths] ACLs applied but verification failed for ${resolved}`);
        return {
          success: true,
          workspacePaths: updated.workspacePaths ?? [],
          warning: 'Permissions applied but verification failed — the agent may not be able to access this path',
        };
      }
    }

    // Scan workspace for skills and apply deny ACLs on unapproved ones
    if (app.workspaceSkillScanner) {
      app.workspaceSkillScanner.onWorkspaceGranted(profileId, resolved);
    }

    // Scan for sensitive files and apply deny ACLs
    if (userName) {
      const sensitiveFiles = scanForSensitiveFiles(resolved);
      const SENSITIVE_DENY_PERMS = 'read,readattr,readextattr,list,search,execute,write,append,writeattr,writeextattr';
      for (const file of sensitiveFiles) {
        addUserAcl(file.path, userName, SENSITIVE_DENY_PERMS, app.log, 'deny');
      }
      if (sensitiveFiles.length > 0) {
        app.log.info(`[workspace-paths] protected ${sensitiveFiles.length} sensitive file(s) in ${resolved}`);
        emitEvent('workspace:sensitive_files_protected', {
          workspacePath: resolved,
          fileCount: sensitiveFiles.length,
          files: sensitiveFiles.map(f => f.path),
        }, profileId);
      }
    }

    emitEvent('workspace:path_granted', { profileId, path: resolved, profileName: updated.name }, profileId);

    return {
      success: true,
      workspacePaths: updated.workspacePaths ?? [],
    };
  });

  /**
   * Revoke access to a workspace directory by removing it from a profile.
   * Used by the Shield UI to manage granted workspace paths.
   */
  app.post('/workspace-paths/revoke', async (request, reply) => {
    const body = request.body as { path?: string; profileId?: string };
    const revokePath = body.path;

    if (!revokePath) {
      return reply.status(400).send({
        success: false,
        error: { message: 'path is required', statusCode: 400 },
      });
    }

    const resolved = path.resolve(revokePath);
    const storage = getStorage();

    let profileId = body.profileId;
    if (!profileId) {
      const targets = storage.profiles.getByType('target');
      if (targets.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { message: 'No target profiles found', statusCode: 404 },
        });
      }
      profileId = targets[0].id;
    }

    const updated = storage.profiles.removeWorkspacePath(profileId, resolved);
    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: { message: `Profile ${profileId} not found`, statusCode: 404 },
      });
    }

    // Remove filesystem ACLs on the revoked path and its traversal ancestors
    const agentUsername = updated.agentUsername;
    if (agentUsername) {
      removeUserAcl(resolved, agentUsername, app.log);
      for (const ancestor of getAncestorsNeedingTraversal(resolved)) {
        removeUserAcl(ancestor, agentUsername, app.log);
      }
    }

    // Cleanup workspace skill records on revoke
    if (app.workspaceSkillScanner) {
      app.workspaceSkillScanner.onWorkspaceRevoked(resolved);
    }

    emitEvent('workspace:path_revoked', { profileId, path: resolved }, profileId);

    return {
      success: true,
      workspacePaths: updated.workspacePaths ?? [],
    };
  });

  /**
   * Fix OS-level permissions for a directory the agent user already has
   * workspace-path access to but can't read at the filesystem level.
   * Used by the router wrapper when _check_cwd_perms detects a gap.
   */
  app.post('/workspace-paths/fix-permissions', async (request, reply) => {
    const body = request.body as { path?: string; agentUser?: string };
    const fixPath = body.path;

    if (!fixPath) {
      return reply.status(400).send({
        success: false,
        error: { message: 'path is required', statusCode: 400 },
      });
    }

    const resolved = path.resolve(fixPath);
    const storage = getStorage();

    // Determine agent username from body or first target profile
    let agentUsername = body.agentUser;
    if (!agentUsername) {
      const targets = storage.profiles.getByType('target');
      if (targets.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { message: 'No target profiles found', statusCode: 404 },
        });
      }
      agentUsername = targets[0].agentUsername;
      if (!agentUsername) {
        return reply.status(400).send({
          success: false,
          error: { message: 'No agent username configured on profile', statusCode: 400 },
        });
      }
    }

    applyWorkspacePathAcls(resolved, agentUsername, app.log);

    // Verify the fix actually worked
    try {
      execSync(
        `sudo -n -u ${JSON.stringify(agentUsername)} test -r ${JSON.stringify(resolved)} -a -x ${JSON.stringify(resolved)} -a -w ${JSON.stringify(resolved)}`,
        { timeout: 5_000, stdio: 'pipe' },
      );
      return { success: true };
    } catch {
      return { success: false, error: { message: 'Permissions applied but verification failed — agent still cannot access the path', statusCode: 500 } };
    }
  });

  /**
   * Verify if an agent user has OS-level read+execute permissions on a path.
   * Uses `sudo -n -u <user> test` — the daemon runs with elevated privileges
   * so NOPASSWD sudo is available, unlike in the router wrapper's shell context.
   */
  app.get('/workspace-paths/verify-permissions', async (request) => {
    const query = request.query as { path?: string; agentUser?: string };
    const checkPath = query.path;
    const agentUser = query.agentUser;

    if (!checkPath || !agentUser) {
      return { accessible: false };
    }

    const resolved = path.resolve(checkPath);

    try {
      // Check target directory is readable + executable
      execSync(
        `sudo -n -u ${JSON.stringify(agentUser)} test -r ${JSON.stringify(resolved)} -a -x ${JSON.stringify(resolved)} -a -w ${JSON.stringify(resolved)}`,
        { timeout: 5_000, stdio: 'pipe' },
      );

      // Also verify ancestors are traversable (execute permission)
      const ancestors = getAncestorsNeedingTraversal(resolved);
      for (const ancestor of ancestors) {
        try {
          execSync(
            `sudo -n -u ${JSON.stringify(agentUser)} test -x ${JSON.stringify(ancestor)}`,
            { timeout: 5_000, stdio: 'pipe' },
          );
        } catch {
          return { accessible: false, reason: `Cannot traverse: ${ancestor}` };
        }
      }

      return { accessible: true };
    } catch {
      return { accessible: false };
    }
  });
}

/** Full read+write permissions for workspace directories (with inheritance for new children) */
const WORKSPACE_PERMS = 'read,readattr,readextattr,list,search,execute,write,append,writeattr,writeextattr,delete,delete_child,file_inherit,directory_inherit';

/** Permissions for existing children (no inherit flags — applied recursively) */
const WORKSPACE_EXISTING_PERMS = 'read,readattr,readextattr,list,search,execute,write,append,writeattr,writeextattr,delete,delete_child';

/** Directories to skip during recursive ACL application (heavy/unneeded) */
const SKIP_DIRS = ['.git', 'node_modules', 'vendor', '.hg', '__pycache__', 'dist', 'build', '.next', '.cache'];

/**
 * Apply macOS ACLs for a workspace path: traversal on ancestors, full read+write on target.
 *
 * The seatbelt sandbox allows `file-read* file-write*` for workspace paths.
 * The ACL layer must also grant write permissions so the agent can create/edit files.
 */
function applyWorkspacePathAcls(
  targetPath: string,
  userName: string,
  log: { warn(msg: string, ...args: unknown[]): void },
): void {
  // Clean orphaned UUID-based ACL entries before applying new ones.
  // Stale entries from deleted agent users can fill the 128-entry macOS ACL limit.
  for (const ancestor of getAncestorsNeedingTraversal(targetPath)) {
    removeOrphanedAcls(ancestor, log);
  }
  removeOrphanedAcls(targetPath, log);

  // Remove existing user ACLs before reapplying — prevents stale read-only entries
  // from blocking the new read+write permissions.
  removeUserAcl(targetPath, userName, log);

  // Grant search (traversal) on non-world-traversable ancestors
  for (const ancestor of getAncestorsNeedingTraversal(targetPath)) {
    addUserAcl(ancestor, userName, 'search', log);
  }

  // Grant full read+write access on the target directory (with inheritance for new files)
  addUserAcl(targetPath, userName, WORKSPACE_PERMS, log);

  // Apply permissions to existing children in background (skip heavy dirs)
  applyWorkspaceAclsAsync(targetPath, userName, log);
}

/**
 * Asynchronously apply ACLs to existing files/directories within a workspace path.
 * Uses `find` with exclusions for heavy directories, pipes to `xargs chmod +a`.
 * Runs in background via SystemCommandExecutor to avoid blocking the request.
 */
function applyWorkspaceAclsAsync(
  targetPath: string,
  userName: string,
  log: { warn(msg: string, ...args: unknown[]): void },
): void {
  const excludes = SKIP_DIRS.map(d => `-not -path ${JSON.stringify(`*/${d}/*`)}`).join(' ');
  const aclSpec = `user:${userName} allow ${WORKSPACE_EXISTING_PERMS}`;
  const cmd = `find ${JSON.stringify(targetPath)} -mindepth 1 ${excludes} -print0 | xargs -0 chmod +a ${JSON.stringify(aclSpec)} 2>/dev/null || true`;

  try {
    const executor = getSystemExecutor();
    executor.exec(cmd, { timeout: 60_000 })
      .then(() => {
        const logger = getLogger();
        logger.info(`[workspace-paths] Recursive ACLs applied for ${targetPath}`);
        emitEvent('workspace:acls_applied', {
          workspacePath: targetPath,
          agentUser: userName,
        });
      })
      .catch((err: Error) => {
        log.warn(`[workspace-paths] Async ACL application failed for ${targetPath}: ${err.message}`);
      });
  } catch (err) {
    log.warn(`[workspace-paths] Failed to start async ACL application for ${targetPath}: ${(err as Error).message}`);
  }
}
