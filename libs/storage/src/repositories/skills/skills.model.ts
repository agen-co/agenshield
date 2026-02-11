/**
 * Skills model — Row mappers (DB row → domain type)
 */

import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';
import type { DbSkillRow, DbSkillVersionRow, DbSkillFileRow, DbSkillInstallationRow } from '../../types';

// ---- Row mappers ----

export function mapSkill(row: DbSkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    author: row.author ?? undefined,
    description: row.description ?? undefined,
    homepage: row.homepage ?? undefined,
    tags: JSON.parse(row.tags),
    source: row.source as Skill['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapVersion(row: DbSkillVersionRow): SkillVersion {
  return {
    id: row.id,
    skillId: row.skill_id,
    version: row.version,
    folderPath: row.folder_path,
    contentHash: row.content_hash,
    hashUpdatedAt: row.hash_updated_at,
    approval: row.approval as SkillVersion['approval'],
    approvedAt: row.approved_at ?? undefined,
    trusted: row.trusted === 1,
    metadataJson: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    analysisStatus: row.analysis_status as SkillVersion['analysisStatus'],
    analysisJson: row.analysis_json ? JSON.parse(row.analysis_json) : undefined,
    analyzedAt: row.analyzed_at ?? undefined,
    requiredBins: JSON.parse(row.required_bins),
    requiredEnv: JSON.parse(row.required_env),
    extractedCommands: JSON.parse(row.extracted_commands),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFile(row: DbSkillFileRow): SkillFile {
  return {
    id: row.id,
    skillVersionId: row.skill_version_id,
    relativePath: row.relative_path,
    fileHash: row.file_hash,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapInstallation(row: DbSkillInstallationRow): SkillInstallation {
  return {
    id: row.id,
    skillVersionId: row.skill_version_id,
    targetId: row.target_id ?? undefined,
    userUsername: row.user_username ?? undefined,
    status: row.status as SkillInstallation['status'],
    wrapperPath: row.wrapper_path ?? undefined,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}
