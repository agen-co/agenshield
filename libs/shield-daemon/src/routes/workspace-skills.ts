/**
 * Workspace skills governance routes
 *
 * Endpoints for listing, approving, denying, requesting cloud approval,
 * and deleting workspace-level skills.
 * Admin-only operations require JWT with role=admin.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { getStorage } from '@agenshield/storage';
import { verifyToken } from '@agenshield/auth';
import { extractToken } from '../auth/middleware';
import { getCloudConnector } from '../services/cloud-connector';
import { readSkillFiles } from '../services/workspace-skill-scanner';

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
    const query = request.query as { workspace?: string; status?: string; profileId?: string };
    const storage = getStorage();

    const profileId = query.profileId
      || (request.headers['x-shield-profile-id'] as string | undefined)
      || undefined;

    let skills;
    if (profileId) {
      skills = storage.workspaceSkills.getByProfile(profileId);
      if (query.workspace) {
        skills = skills.filter((s) => s.workspacePath === query.workspace);
      }
      if (query.status) {
        skills = skills.filter((s) => s.status === query.status);
      }
    } else if (query.workspace) {
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
  app.get('/workspace-skills/pending-count', async (request) => {
    const storage = getStorage();
    const profileId = (request.query as { profileId?: string }).profileId
      || (request.headers['x-shield-profile-id'] as string | undefined)
      || undefined;

    const count = profileId
      ? storage.workspaceSkills.countByStatusForProfile('pending', profileId)
      : storage.workspaceSkills.countByStatus('pending');
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

  /**
   * POST /workspace-skills/:id/request-approval — Upload skill to cloud for admin review.
   * Reads skill files from disk and sends them to the cloud for CISO analysis.
   */
  app.post('/workspace-skills/:id/request-approval', async (request, reply) => {
    const { id } = request.params as { id: string };
    const storage = getStorage();

    const skill = storage.workspaceSkills.getById(id);
    if (!skill) {
      return reply.status(404).send({
        success: false,
        error: { message: `Workspace skill not found: ${id}`, statusCode: 404 },
      });
    }

    if (skill.status !== 'pending' && skill.status !== 'denied') {
      return reply.status(400).send({
        success: false,
        error: { message: `Skill is not pending or denied (status: ${skill.status})`, statusCode: 400 },
      });
    }

    const connector = getCloudConnector();
    if (!connector.isConnected()) {
      return reply.status(503).send({
        success: false,
        error: { message: 'Not connected to AgenShield Cloud', statusCode: 503 },
      });
    }

    // Idempotent: if cloudSkillId already exists, don't re-submit
    if (skill.cloudSkillId) {
      return { success: true, data: { cloudSkillId: skill.cloudSkillId, existingDecision: undefined } };
    }

    // Read skill files from disk for cloud review
    const skillDir = path.join(skill.workspacePath, '.claude', 'skills', skill.skillName);
    const files = fs.existsSync(skillDir) ? readSkillFiles(skillDir) : [];

    // Build metadata — flag tampered re-submissions
    const metadata: Record<string, unknown> = {};
    if (skill.approvedBy) {
      metadata.tampered = true;
      metadata.previousApprovedBy = skill.approvedBy;
    }

    const result = await connector.reportQuarantinedSkill(
      skill.contentHash ?? '',
      skill.skillName,
      skill.workspacePath,
      files,
      metadata,
    );

    // Update DB with cloud skill ID if returned
    if (result.id) {
      storage.workspaceSkills.update(id, { cloudSkillId: result.id });
    }

    // If cloud already has a decision, apply it locally and rescan all workspaces
    if (result.existingDecision === 'approved' && skill.contentHash) {
      storage.approvedSkillHashes.upsert(skill.contentHash, skill.skillName);
      const scanner = app.workspaceSkillScanner;
      if (scanner) {
        // Rescan all workspaces to approve all entries with the same hash
        scanner.scanAllWorkspaces();
      }
    }

    return { success: true, data: { cloudSkillId: result.id, existingDecision: result.existingDecision } };
  });

  /**
   * POST /workspace-skills/:id/delete — Delete skill files from disk.
   * Removes the skill directory and marks the DB record as removed.
   */
  app.post('/workspace-skills/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const storage = getStorage();

    const skill = storage.workspaceSkills.getById(id);
    if (!skill) {
      return reply.status(404).send({
        success: false,
        error: { message: `Workspace skill not found: ${id}`, statusCode: 404 },
      });
    }

    // Remove skill directory from disk
    const skillDir = path.join(skill.workspacePath, '.claude', 'skills', skill.skillName);
    try {
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
      }
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: { message: `Failed to delete skill files: ${(err as Error).message}`, statusCode: 500 },
      });
    }

    // Mark as removed in DB
    storage.workspaceSkills.markRemoved(id);

    // Remove deny ACL if scanner is available
    const scanner = app.workspaceSkillScanner;
    if (scanner) {
      try {
        const { allowWorkspaceSkill } = await import('../acl');
        const profile = storage.profiles.getById(skill.profileId);
        const agentUsername = (profile as { agentUsername?: string } | null)?.agentUsername ?? '';
        if (agentUsername) {
          allowWorkspaceSkill(skillDir, agentUsername, request.log);
        }
      } catch { /* best effort ACL cleanup */ }
    }

    return { success: true, data: { deleted: true } };
  });
}

