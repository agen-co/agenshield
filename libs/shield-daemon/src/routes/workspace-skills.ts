/**
 * Workspace skills governance routes
 *
 * Endpoints for listing, approving, and denying workspace-level skills.
 * Admin-only operations require JWT with role=admin.
 */

import type { FastifyInstance } from 'fastify';
import { getStorage } from '@agenshield/storage';
import { verifyToken } from '@agenshield/auth';
import { extractToken } from '../auth/middleware';

/**
 * Verify that the request has admin-level JWT authentication.
 * Returns the userId on success, or sends a 403 and returns null.
 */
async function requireAdmin(
  request: { headers: Record<string, string | string[] | undefined> },
  reply: { status(code: number): { send(body: unknown): unknown } },
): Promise<string | null> {
  const token = extractToken(request as Parameters<typeof extractToken>[0]);
  if (!token) {
    reply.status(401).send({ success: false, error: { message: 'Authentication required' } });
    return null;
  }

  const result = await verifyToken(token);
  if (!result.valid || !result.payload || result.payload.role !== 'admin') {
    reply.status(403).send({ success: false, error: { message: 'Admin role required' } });
    return null;
  }

  return result.payload.sub ?? 'admin';
}

export async function workspaceSkillsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /workspace-skills — List all workspace skills.
   * Supports ?workspace= and ?status= query filters.
   */
  app.get('/workspace-skills', async (request) => {
    const query = request.query as { workspace?: string; status?: string };
    const storage = getStorage();

    let skills;
    if (query.workspace) {
      skills = storage.workspaceSkills.getByWorkspace(query.workspace);
      if (query.status) {
        skills = skills.filter((s) => s.status === query.status);
      }
    } else if (query.status) {
      skills = storage.workspaceSkills.getByStatus(query.status);
    } else {
      skills = storage.workspaceSkills.getAllActive();
    }

    return { success: true, data: skills };
  });

  /**
   * GET /workspace-skills/pending-count — Count of pending skills (for UI badge).
   */
  app.get('/workspace-skills/pending-count', async () => {
    const storage = getStorage();
    const count = storage.workspaceSkills.countByStatus('pending');
    return { success: true, data: { count } };
  });

  /**
   * GET /workspace-skills/:id — Detail with file list.
   */
  app.get('/workspace-skills/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const storage = getStorage();

    const skill = storage.workspaceSkills.getById(id);
    if (!skill) {
      return reply.status(404).send({
        success: false,
        error: { message: `Workspace skill not found: ${id}`, statusCode: 404 },
      });
    }

    return { success: true, data: skill };
  });

  /**
   * POST /workspace-skills/:id/approve — Approve a workspace skill.
   * Requires admin JWT. Creates backup and removes deny ACL.
   */
  app.post('/workspace-skills/:id/approve', async (request, reply) => {
    const userId = await requireAdmin(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const scanner = app.workspaceSkillScanner;

    if (!scanner) {
      return reply.status(503).send({
        success: false,
        error: { message: 'Workspace skill scanner is initializing. Please wait for daemon setup to complete.', statusCode: 503 },
      });
    }

    const updated = scanner.approveSkill(id, `admin:${userId}`);
    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: { message: `Workspace skill not found: ${id}`, statusCode: 404 },
      });
    }

    return { success: true, data: updated };
  });

  /**
   * POST /workspace-skills/:id/deny — Deny a workspace skill.
   * Requires admin JWT. Ensures deny ACL is applied.
   */
  app.post('/workspace-skills/:id/deny', async (request, reply) => {
    const userId = await requireAdmin(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const scanner = app.workspaceSkillScanner;

    if (!scanner) {
      return reply.status(503).send({
        success: false,
        error: { message: 'Workspace skill scanner is initializing. Please wait for daemon setup to complete.', statusCode: 503 },
      });
    }

    const updated = scanner.denySkill(id);
    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: { message: `Workspace skill not found: ${id}`, statusCode: 404 },
      });
    }

    return { success: true, data: updated };
  });

  /**
   * POST /workspace-skills/scan — Force re-scan.
   * Requires admin JWT. Optionally accepts { workspacePath } to scan a single workspace.
   */
  app.post('/workspace-skills/scan', async (request, reply) => {
    const userId = await requireAdmin(request, reply);
    if (!userId) return;

    const body = request.body as { workspacePath?: string } | null;
    const scanner = app.workspaceSkillScanner;

    if (!scanner) {
      return reply.status(503).send({
        success: false,
        error: { message: 'Workspace skill scanner is initializing. Please wait for daemon setup to complete.', statusCode: 503 },
      });
    }

    if (body?.workspacePath) {
      const storage = getStorage();
      // Find a profile with this workspace path
      const profiles = storage.profiles.getByType('target');
      const profile = profiles.find((p) =>
        (p.workspacePaths ?? []).includes(body.workspacePath!),
      );

      if (!profile) {
        return reply.status(404).send({
          success: false,
          error: { message: `No profile found with workspace path: ${body.workspacePath}`, statusCode: 404 },
        });
      }

      const skills = scanner.scanWorkspace(profile.id, body.workspacePath!);
      return { success: true, data: skills };
    }

    scanner.scanAllWorkspaces();
    const storage = getStorage();
    const allSkills = storage.workspaceSkills.getAllActive();
    return { success: true, data: allSkills };
  });
}
