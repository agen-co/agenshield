/**
 * Skills SQL queries
 */

const SKILLS = 'skills';
const VERSIONS = 'skill_versions';
const FILES = 'skill_files';
const INSTALLATIONS = 'skill_installations';

export const Q = {
  // ---- Skills ----
  insertSkill: `
    INSERT INTO ${SKILLS} (id, name, slug, author, description, homepage, tags, source, created_at, updated_at)
    VALUES (@id, @name, @slug, @author, @description, @homepage, @tags, @source, @createdAt, @updatedAt)`,

  selectSkillById: `SELECT * FROM ${SKILLS} WHERE id = ?`,
  selectSkillBySlug: `SELECT * FROM ${SKILLS} WHERE slug = ?`,
  selectAllSkills: `SELECT * FROM ${SKILLS} ORDER BY name`,
  selectSkillsBySource: `SELECT * FROM ${SKILLS} WHERE source = ? ORDER BY name`,
  deleteSkill: `DELETE FROM ${SKILLS} WHERE id = ?`,

  // ---- Versions ----
  insertVersion: `
    INSERT INTO ${VERSIONS} (id, skill_id, version, folder_path, content_hash, hash_updated_at,
      approval, approved_at, trusted, metadata_json, analysis_status, analysis_json, analyzed_at,
      required_bins, required_env, extracted_commands, created_at, updated_at)
    VALUES (@id, @skillId, @version, @folderPath, @contentHash, @hashUpdatedAt,
      @approval, @approvedAt, @trusted, @metadataJson, @analysisStatus, @analysisJson, @analyzedAt,
      @requiredBins, @requiredEnv, @extractedCommands, @createdAt, @updatedAt)`,

  selectVersion: `SELECT * FROM ${VERSIONS} WHERE skill_id = ? AND version = ?`,
  selectVersionById: `SELECT * FROM ${VERSIONS} WHERE id = ?`,
  selectVersions: `SELECT * FROM ${VERSIONS} WHERE skill_id = ? ORDER BY created_at DESC`,
  selectLatestVersion: `SELECT * FROM ${VERSIONS} WHERE skill_id = ? ORDER BY created_at DESC LIMIT 1`,

  updateAnalysis: `
    UPDATE ${VERSIONS} SET analysis_status = @status, analysis_json = @json,
      analyzed_at = @analyzedAt, updated_at = @updatedAt WHERE id = @id`,

  approveVersion: `UPDATE ${VERSIONS} SET approval = 'approved', approved_at = @now, updated_at = @now WHERE id = @id`,
  quarantineVersion: `UPDATE ${VERSIONS} SET approval = 'quarantined', updated_at = @now WHERE id = @id`,

  updateContentHash: `UPDATE ${VERSIONS} SET content_hash = @hash, hash_updated_at = @now, updated_at = @now WHERE id = @id`,

  // ---- Files ----
  upsertFile: `
    INSERT INTO ${FILES} (id, skill_version_id, relative_path, file_hash, size_bytes, created_at, updated_at)
    VALUES (@id, @versionId, @relativePath, @fileHash, @sizeBytes, @createdAt, @updatedAt)
    ON CONFLICT(skill_version_id, relative_path) DO UPDATE SET
      file_hash = @fileHash, size_bytes = @sizeBytes, updated_at = @updatedAt`,

  selectFiles: `SELECT * FROM ${FILES} WHERE skill_version_id = ? ORDER BY relative_path`,
  updateFileHash: `UPDATE ${FILES} SET file_hash = @hash, updated_at = @now WHERE id = @id`,

  // ---- Installations ----
  insertInstallation: `
    INSERT INTO ${INSTALLATIONS} (id, skill_version_id, target_id, user_username, status, wrapper_path, installed_at, updated_at)
    VALUES (@id, @skillVersionId, @targetId, @userUsername, @status, @wrapperPath, @installedAt, @updatedAt)`,

  deleteInstallation: `DELETE FROM ${INSTALLATIONS} WHERE id = ?`,
  updateInstallationStatus: `UPDATE ${INSTALLATIONS} SET status = @status, updated_at = @now WHERE id = @id`,

  selectInstalledSkills: (scopeConditions: string) => `
    SELECT s.*, sv.id as sv_id, sv.skill_id as sv_skill_id, sv.version as sv_version, sv.folder_path as sv_folder_path,
      sv.content_hash as sv_content_hash, sv.hash_updated_at as sv_hash_updated_at,
      sv.approval as sv_approval, sv.approved_at as sv_approved_at, sv.trusted as sv_trusted,
      sv.metadata_json as sv_metadata_json, sv.analysis_status as sv_analysis_status,
      sv.analysis_json as sv_analysis_json, sv.analyzed_at as sv_analyzed_at,
      sv.required_bins as sv_required_bins, sv.required_env as sv_required_env,
      sv.extracted_commands as sv_extracted_commands, sv.created_at as sv_created_at, sv.updated_at as sv_updated_at
    FROM ${INSTALLATIONS} si
    JOIN ${VERSIONS} sv ON si.skill_version_id = sv.id
    JOIN ${SKILLS} s ON sv.skill_id = s.id
    WHERE si.status = 'active' AND (${scopeConditions})
    ORDER BY s.name`,
} as const;
