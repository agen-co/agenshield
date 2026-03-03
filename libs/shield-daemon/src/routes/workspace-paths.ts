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
import { addUserAcl, getAncestorsNeedingTraversal } from '../acl';

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
          `sudo -n -u ${JSON.stringify(userName)} test -r ${JSON.stringify(resolved)} -a -x ${JSON.stringify(resolved)}`,
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

    // Cleanup workspace skill records on revoke
    if (app.workspaceSkillScanner) {
      app.workspaceSkillScanner.onWorkspaceRevoked(resolved);
    }

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
        `sudo -n -u ${JSON.stringify(agentUsername)} test -r ${JSON.stringify(resolved)} -a -x ${JSON.stringify(resolved)}`,
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
        `sudo -n -u ${JSON.stringify(agentUser)} test -r ${JSON.stringify(resolved)} -a -x ${JSON.stringify(resolved)}`,
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

const READ_PERMS = 'read,readattr,readextattr,list,search,execute';

/**
 * Apply macOS ACLs for a workspace path: traversal on ancestors, full read on target.
 */
function applyWorkspacePathAcls(
  targetPath: string,
  userName: string,
  log: { warn(msg: string, ...args: unknown[]): void },
): void {
  // Grant search (traversal) on non-world-traversable ancestors
  for (const ancestor of getAncestorsNeedingTraversal(targetPath)) {
    addUserAcl(ancestor, userName, 'search', log);
  }

  // Grant full read access on the target directory
  addUserAcl(targetPath, userName, READ_PERMS, log);
}
