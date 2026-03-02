/**
 * Workspace path management routes
 *
 * Provides check and grant endpoints for the router wrapper
 * to validate and register allowed workspace directories.
 */

import type { FastifyInstance } from 'fastify';
import * as path from 'node:path';
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

    return { success: true };
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
