/**
 * Workspace skills repository
 *
 * Manages workspace-level skill records for governance.
 * Skills found in `.claude/skills/` directories require admin approval
 * before the agent user can access them.
 */

import type { WorkspaceSkill } from '@agenshield/ipc';
import type { DbWorkspaceSkillRow } from '../../types';
import { BaseRepository } from '../base.repository';
import { mapWorkspaceSkill } from './workspace-skills.model';
import { Q } from './workspace-skills.query';
import {
  CreateWorkspaceSkillSchema,
  UpdateWorkspaceSkillSchema,
  UpdateWorkspaceSkillCodec,
} from './workspace-skills.schema';
import type { CreateWorkspaceSkillInput, UpdateWorkspaceSkillInput } from './workspace-skills.schema';

export class WorkspaceSkillsRepository extends BaseRepository {
  /**
   * Create a new workspace skill record.
   */
  create(input: CreateWorkspaceSkillInput): WorkspaceSkill {
    const data = this.validate(CreateWorkspaceSkillSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insert).run({
      id,
      profileId: data.profileId,
      workspacePath: data.workspacePath,
      skillName: data.skillName,
      status: data.status ?? 'pending',
      contentHash: data.contentHash ?? null,
      approvedBy: data.approvedBy ?? null,
      approvedAt: data.approvedAt ?? null,
      cloudSkillId: data.cloudSkillId ?? null,
      aclApplied: data.aclApplied ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      profileId: data.profileId,
      workspacePath: data.workspacePath,
      skillName: data.skillName,
      status: data.status ?? 'pending',
      contentHash: data.contentHash,
      aclApplied: data.aclApplied ?? false,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a workspace skill by ID.
   */
  getById(id: string): WorkspaceSkill | null {
    const row = this.db.prepare(Q.selectById).get(id) as DbWorkspaceSkillRow | undefined;
    return row ? mapWorkspaceSkill(row) : null;
  }

  /**
   * Get a workspace skill by its unique key (workspace_path + skill_name).
   */
  getByKey(workspacePath: string, skillName: string): WorkspaceSkill | null {
    const row = this.db.prepare(Q.selectByKey).get({ workspacePath, skillName }) as
      | DbWorkspaceSkillRow
      | undefined;
    return row ? mapWorkspaceSkill(row) : null;
  }

  /**
   * Get all workspace skills for a given workspace path.
   */
  getByWorkspace(workspacePath: string): WorkspaceSkill[] {
    const rows = this.db.prepare(Q.selectByWorkspace).all(workspacePath) as DbWorkspaceSkillRow[];
    return rows.map(mapWorkspaceSkill);
  }

  /**
   * Get all workspace skills with a specific status.
   */
  getByStatus(status: string): WorkspaceSkill[] {
    const rows = this.db.prepare(Q.selectByStatus).all(status) as DbWorkspaceSkillRow[];
    return rows.map(mapWorkspaceSkill);
  }

  /**
   * Get all active (non-removed) workspace skills.
   */
  getAllActive(): WorkspaceSkill[] {
    const rows = this.db.prepare(Q.selectAllActive).all() as DbWorkspaceSkillRow[];
    return rows.map(mapWorkspaceSkill);
  }

  /**
   * Get all pending workspace skills across all workspaces.
   */
  getPending(): WorkspaceSkill[] {
    const rows = this.db.prepare(Q.selectPending).all() as DbWorkspaceSkillRow[];
    return rows.map(mapWorkspaceSkill);
  }

  /**
   * Get names of approved/cloud_forced skills for a workspace (for ACL sync).
   */
  getApprovedNames(workspacePath: string): string[] {
    const rows = this.db.prepare(Q.selectApprovedNames).all(workspacePath) as Array<{
      skill_name: string;
    }>;
    return rows.map((r) => r.skill_name);
  }

  /**
   * Get all active (non-removed) workspace skills for a specific profile.
   */
  getByProfile(profileId: string): WorkspaceSkill[] {
    const rows = this.db.prepare(Q.selectByProfile).all(profileId) as DbWorkspaceSkillRow[];
    return rows.map(mapWorkspaceSkill);
  }

  /**
   * Count skills by status.
   */
  countByStatus(status: string): number {
    const row = this.db.prepare(Q.countByStatus).get(status) as { count: number };
    return row.count;
  }

  /**
   * Count skills by status for a specific profile.
   */
  countByStatusForProfile(status: string, profileId: string): number {
    const row = this.db.prepare(Q.countByStatusAndProfile).get({ status, profileId }) as { count: number };
    return row.count;
  }

  /**
   * Update a workspace skill record.
   */
  update(id: string, input: UpdateWorkspaceSkillInput): WorkspaceSkill | null {
    const data = this.validate(UpdateWorkspaceSkillSchema, input);
    if (!this.getById(id)) return null;
    const encoded = UpdateWorkspaceSkillCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'workspace_skills', 'id = @id', { id });
    return this.getById(id);
  }

  /**
   * Mark a workspace skill as removed (soft delete).
   */
  markRemoved(id: string): WorkspaceSkill | null {
    return this.update(id, {
      status: 'removed',
      removedAt: this.now(),
    });
  }

  /**
   * Hard-delete a workspace skill record.
   */
  delete(id: string): boolean {
    const result = this.db.prepare(Q.deleteById).run(id);
    return result.changes > 0;
  }
}
