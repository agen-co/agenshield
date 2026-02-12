/**
 * Skills repository — Unified skill registry with versions, files, and installations
 */

import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';
import type { DbSkillRow, DbSkillVersionRow, DbSkillFileRow, DbSkillInstallationRow } from '../../types';
import { BaseRepository } from '../base.repository';
import {
  CreateSkillSchema, CreateSkillVersionSchema, CreateSkillInstallationSchema,
  UpdateSkillSchema, UpdateSkillVersionAnalysisSchema, UpdateInstallationStatusSchema,
  UpdateSkillCodec,
} from './skills.schema';
import type {
  CreateSkillInput, CreateSkillVersionInput, CreateSkillInstallationInput,
  UpdateSkillInput, UpdateSkillVersionAnalysisInput, UpdateInstallationStatusInput,
  SkillsGetAllFilter, SkillInstallationsFilter, GetVersionParams, RegisterFilesParams, UpdateFileHashParams,
} from './skills.schema';
import { mapSkill, mapVersion, mapFile, mapInstallation } from './skills.model';
import { Q } from './skills.query';
import * as crypto from 'node:crypto';

export class SkillsRepository extends BaseRepository {
  // ---- Skill identity ----

  create(input: CreateSkillInput): Skill {
    const data = this.validate(CreateSkillSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insertSkill).run({
      id, name: data.name, slug: data.slug,
      author: data.author ?? null, description: data.description ?? null,
      homepage: data.homepage ?? null, tags: JSON.stringify(data.tags),
      source: data.source, remoteId: data.remoteId ?? null,
      isPublic: data.isPublic !== undefined ? (data.isPublic ? 1 : 0) : 1,
      createdAt: now, updatedAt: now,
    });

    return {
      id, ...data, tags: data.tags ?? [], source: data.source ?? 'unknown',
      isPublic: data.isPublic ?? true, createdAt: now, updatedAt: now,
    };
  }

  getById(id: string): Skill | null {
    const row = this.db.prepare(Q.selectSkillById).get(id) as DbSkillRow | undefined;
    return row ? mapSkill(row) : null;
  }

  getBySlug(slug: string): Skill | null {
    const row = this.db.prepare(Q.selectSkillBySlug).get(slug) as DbSkillRow | undefined;
    return row ? mapSkill(row) : null;
  }

  getAll(filter?: SkillsGetAllFilter): Skill[] {
    const rows = filter?.source
      ? this.db.prepare(Q.selectSkillsBySource).all(filter.source) as DbSkillRow[]
      : this.db.prepare(Q.selectAllSkills).all() as DbSkillRow[];
    return rows.map(mapSkill);
  }

  update(id: string, input: UpdateSkillInput): Skill | null {
    const data = this.validate(UpdateSkillSchema, input);
    if (!this.getById(id)) return null;
    const encoded = UpdateSkillCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'skills', 'id = @id', { id });
    return this.getById(id);
  }

  delete(id: string): boolean {
    return this.db.prepare(Q.deleteSkill).run(id).changes > 0;
  }

  getByRemoteId(remoteId: string): Skill | null {
    const row = this.db.prepare(Q.selectSkillByRemoteId).get(remoteId) as DbSkillRow | undefined;
    return row ? mapSkill(row) : null;
  }

  search(query: string): Skill[] {
    const likeQuery = `%${query}%`;
    const rows = this.db.prepare(Q.searchSkills).all({ query: likeQuery }) as DbSkillRow[];
    return rows.map(mapSkill);
  }

  // ---- Versions ----

  addVersion(input: CreateSkillVersionInput): SkillVersion {
    const data = this.validate(CreateSkillVersionSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insertVersion).run({
      id, skillId: data.skillId, version: data.version, folderPath: data.folderPath,
      contentHash: data.contentHash, hashUpdatedAt: data.hashUpdatedAt,
      approval: data.approval, approvedAt: data.approvedAt ?? null,
      trusted: data.trusted ? 1 : 0,
      metadataJson: data.metadataJson != null ? JSON.stringify(data.metadataJson) : null,
      analysisStatus: data.analysisStatus,
      analysisJson: data.analysisJson != null ? JSON.stringify(data.analysisJson) : null,
      analyzedAt: data.analyzedAt ?? null,
      requiredBins: JSON.stringify(data.requiredBins),
      requiredEnv: JSON.stringify(data.requiredEnv),
      extractedCommands: JSON.stringify(data.extractedCommands),
      createdAt: now, updatedAt: now,
    });

    return { id, ...data, createdAt: now, updatedAt: now } as SkillVersion;
  }

  getVersion(params: GetVersionParams): SkillVersion | null {
    const row = this.db.prepare(Q.selectVersion).get(params.skillId, params.version) as DbSkillVersionRow | undefined;
    return row ? mapVersion(row) : null;
  }

  getVersionById(id: string): SkillVersion | null {
    const row = this.db.prepare(Q.selectVersionById).get(id) as DbSkillVersionRow | undefined;
    return row ? mapVersion(row) : null;
  }

  getVersions(skillId: string): SkillVersion[] {
    return (this.db.prepare(Q.selectVersions).all(skillId) as DbSkillVersionRow[]).map(mapVersion);
  }

  getLatestVersion(skillId: string): SkillVersion | null {
    const row = this.db.prepare(Q.selectLatestVersion).get(skillId) as DbSkillVersionRow | undefined;
    return row ? mapVersion(row) : null;
  }

  updateAnalysis(versionId: string, input: UpdateSkillVersionAnalysisInput): void {
    const data = this.validate(UpdateSkillVersionAnalysisSchema, input);
    const now = this.now();
    this.db.prepare(Q.updateAnalysis).run({
      id: versionId, status: data.status,
      json: data.json != null ? JSON.stringify(data.json) : null,
      analyzedAt: data.analyzedAt ?? now, updatedAt: now,
    });
  }

  approveVersion(versionId: string): void {
    this.db.prepare(Q.approveVersion).run({ id: versionId, now: this.now() });
  }

  quarantineVersion(versionId: string): void {
    this.db.prepare(Q.quarantineVersion).run({ id: versionId, now: this.now() });
  }

  deleteVersion(id: string): boolean {
    return this.db.prepare(Q.deleteVersion).run(id).changes > 0;
  }

  // ---- Files ----

  registerFiles(params: RegisterFilesParams): SkillFile[] {
    const now = this.now();
    const stmt = this.db.prepare(Q.upsertFile);
    const results: SkillFile[] = [];

    for (const f of params.files) {
      const id = this.generateId();
      stmt.run({ id, versionId: params.versionId, relativePath: f.relativePath, fileHash: f.fileHash, sizeBytes: f.sizeBytes, createdAt: now, updatedAt: now });
      results.push({ id, skillVersionId: params.versionId, relativePath: f.relativePath, fileHash: f.fileHash, sizeBytes: f.sizeBytes, createdAt: now, updatedAt: now });
    }
    return results;
  }

  getFiles(versionId: string): SkillFile[] {
    return (this.db.prepare(Q.selectFiles).all(versionId) as DbSkillFileRow[]).map(mapFile);
  }

  updateFileHash(params: UpdateFileHashParams): void {
    this.db.prepare(Q.updateFileHash).run({ id: params.fileId, hash: params.newHash, now: this.now() });
  }

  recomputeContentHash(versionId: string): string {
    const files = this.getFiles(versionId);
    const combined = files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)).map((f) => f.fileHash).join('');
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    this.db.prepare(Q.updateContentHash).run({ id: versionId, hash, now: this.now() });
    return hash;
  }

  // ---- Installations ----

  install(input: CreateSkillInstallationInput): SkillInstallation {
    const data = this.validate(CreateSkillInstallationSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insertInstallation).run({
      id, skillVersionId: data.skillVersionId,
      targetId: data.targetId ?? null, userUsername: data.userUsername ?? null,
      status: data.status, wrapperPath: data.wrapperPath ?? null,
      autoUpdate: data.autoUpdate !== undefined ? (data.autoUpdate ? 1 : 0) : 1,
      pinnedVersion: data.pinnedVersion ?? null,
      installedAt: now, updatedAt: now,
    });

    return {
      id, ...data, autoUpdate: data.autoUpdate ?? true,
      installedAt: now, updatedAt: now,
    } as SkillInstallation;
  }

  uninstall(installationId: string): boolean {
    return this.db.prepare(Q.deleteInstallation).run(installationId).changes > 0;
  }

  getInstallationById(id: string): SkillInstallation | null {
    const row = this.db.prepare(Q.selectInstallationById).get(id) as DbSkillInstallationRow | undefined;
    return row ? mapInstallation(row) : null;
  }

  getInstallations(filter?: SkillInstallationsFilter): SkillInstallation[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter?.skillVersionId) { conditions.push('skill_version_id = @skillVersionId'); params.skillVersionId = filter.skillVersionId; }
    if (filter?.targetId) { conditions.push('target_id = @targetId'); params.targetId = filter.targetId; }
    if (filter?.userUsername) { conditions.push('user_username = @userUsername'); params.userUsername = filter.userUsername; }

    // Scope filtering: when this.scope is set, restrict to global + matching hierarchy levels
    if (this.scope) {
      const scopeParts = ['(target_id IS NULL AND user_username IS NULL)'];
      if (this.scope.targetId) {
        scopeParts.push('(target_id = @scopeTargetId AND user_username IS NULL)');
        params.scopeTargetId = this.scope.targetId;
      }
      if (this.scope.targetId && this.scope.userUsername) {
        scopeParts.push('(target_id = @scopeTargetId AND user_username = @scopeUserUsername)');
        params.scopeUserUsername = this.scope.userUsername;
      } else if (this.scope.userUsername) {
        scopeParts.push('(target_id IS NULL AND user_username = @scopeUserUsername)');
        params.scopeUserUsername = this.scope.userUsername;
      }
      conditions.push(`(${scopeParts.join(' OR ')})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return (this.db.prepare(`SELECT * FROM skill_installations ${where} ORDER BY installed_at DESC`).all(params) as DbSkillInstallationRow[]).map(mapInstallation);
  }

  updateInstallationStatus(id: string, input: UpdateInstallationStatusInput): void {
    const data = this.validate(UpdateInstallationStatusSchema, input);
    this.db.prepare(Q.updateInstallationStatus).run({ id, status: data.status, now: this.now() });
  }

  getAutoUpdatable(skillId: string): SkillInstallation[] {
    const scopeParts: string[] = [];
    const params: Record<string, unknown> = { skillId };

    if (this.scope) {
      scopeParts.push('(si.target_id IS NULL AND si.user_username IS NULL)');
      if (this.scope.targetId) {
        scopeParts.push('(si.target_id = @scopeTargetId AND si.user_username IS NULL)');
        params.scopeTargetId = this.scope.targetId;
      }
      if (this.scope.targetId && this.scope.userUsername) {
        scopeParts.push('(si.target_id = @scopeTargetId AND si.user_username = @scopeUserUsername)');
        params.scopeUserUsername = this.scope.userUsername;
      } else if (this.scope.userUsername) {
        scopeParts.push('(si.target_id IS NULL AND si.user_username = @scopeUserUsername)');
        params.scopeUserUsername = this.scope.userUsername;
      }
    }

    const scopeClause = scopeParts.length > 0 ? scopeParts.join(' OR ') : undefined;
    const rows = this.db.prepare(Q.selectAutoUpdatable(scopeClause)).all(params) as DbSkillInstallationRow[];
    return rows.map(mapInstallation);
  }

  setAutoUpdate(installationId: string, enabled: boolean): void {
    this.db.prepare(Q.setAutoUpdate).run({ id: installationId, autoUpdate: enabled ? 1 : 0, now: this.now() });
  }

  updateInstallationVersion(installationId: string, newVersionId: string): void {
    this.db.prepare(Q.updateInstallationVersion).run({ id: installationId, versionId: newVersionId, now: this.now() });
  }

  updateWrapperPath(installationId: string, wrapperPath: string): void {
    this.db.prepare(Q.updateWrapperPath).run({ id: installationId, wrapperPath, now: this.now() });
  }

  pinVersion(installationId: string, version: string): void {
    this.db.prepare(Q.pinVersion).run({ id: installationId, version, now: this.now() });
  }

  unpinVersion(installationId: string): void {
    this.db.prepare(Q.unpinVersion).run({ id: installationId, now: this.now() });
  }

  getInstalledSkills(): Array<Skill & { version: SkillVersion }> {
    const scopeConditions = ['(si.target_id IS NULL AND si.user_username IS NULL)'];
    const params: Record<string, unknown> = {};

    if (this.scope?.targetId) {
      scopeConditions.push('(si.target_id = @targetId AND si.user_username IS NULL)');
      params.targetId = this.scope.targetId;
    }
    if (this.scope?.targetId && this.scope?.userUsername) {
      scopeConditions.push('(si.target_id = @targetId AND si.user_username = @userUsername)');
      params.userUsername = this.scope.userUsername;
    } else if (this.scope?.userUsername) {
      scopeConditions.push('(si.target_id IS NULL AND si.user_username = @userUsername)');
      params.userUsername = this.scope.userUsername;
    }

    const rows = this.db.prepare(Q.selectInstalledSkills(scopeConditions.join(' OR '))).all(params) as Array<DbSkillRow & Record<string, unknown>>;

    return rows.map((r) => ({
      ...mapSkill(r),
      version: mapVersion({
        id: r.sv_id as string, skill_id: r.sv_skill_id as string, version: r.sv_version as string,
        folder_path: r.sv_folder_path as string, content_hash: r.sv_content_hash as string,
        hash_updated_at: r.sv_hash_updated_at as string, approval: r.sv_approval as string,
        approved_at: r.sv_approved_at as string | null, trusted: r.sv_trusted as number,
        metadata_json: r.sv_metadata_json as string | null, analysis_status: r.sv_analysis_status as string,
        analysis_json: r.sv_analysis_json as string | null, analyzed_at: r.sv_analyzed_at as string | null,
        required_bins: r.sv_required_bins as string, required_env: r.sv_required_env as string,
        extracted_commands: r.sv_extracted_commands as string,
        created_at: r.sv_created_at as string, updated_at: r.sv_updated_at as string,
      }),
    }));
  }
}
