/**
 * Typed error classes for the skills library
 */

export class SkillsError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'SkillsError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class SkillNotFoundError extends SkillsError {
  public readonly skillId?: string;

  constructor(skillId?: string) {
    super(skillId ? `Skill not found: ${skillId}` : 'Skill not found', 'SKILL_NOT_FOUND');
    this.name = 'SkillNotFoundError';
    this.skillId = skillId;
  }
}

export class VersionNotFoundError extends SkillsError {
  public readonly versionId?: string;
  public readonly skillSlug?: string;

  constructor(identifier: string, opts?: { skillSlug?: string }) {
    super(
      opts?.skillSlug
        ? `No version found for skill ${opts.skillSlug}`
        : `Version not found: ${identifier}`,
      'VERSION_NOT_FOUND',
    );
    this.name = 'VersionNotFoundError';
    this.versionId = identifier;
    this.skillSlug = opts?.skillSlug;
  }
}

export class RemoteSkillNotFoundError extends SkillsError {
  public readonly remoteId: string;

  constructor(remoteId: string) {
    super(`Remote skill not found: ${remoteId}`, 'REMOTE_SKILL_NOT_FOUND');
    this.name = 'RemoteSkillNotFoundError';
    this.remoteId = remoteId;
  }
}

export class RemoteApiError extends SkillsError {
  public readonly statusCode: number;
  public readonly responseBody?: string;

  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message, 'REMOTE_API_ERROR');
    this.name = 'RemoteApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export class AnalysisError extends SkillsError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message, 'ANALYSIS_ERROR');
    this.name = 'AnalysisError';
    this.statusCode = statusCode;
  }
}

export class BackupTamperError extends SkillsError {
  public readonly versionId: string;

  constructor(versionId: string) {
    super(`Backup files for version ${versionId} have been tampered with`, 'BACKUP_TAMPERED');
    this.name = 'BackupTamperError';
    this.versionId = versionId;
  }
}
