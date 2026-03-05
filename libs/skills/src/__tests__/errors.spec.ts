import {
  SkillsError,
  SkillNotFoundError,
  VersionNotFoundError,
  RemoteSkillNotFoundError,
  RemoteApiError,
  AnalysisError,
  BackupTamperError,
} from '../errors';

describe('SkillsError', () => {
  it('sets name, code, and message', () => {
    const err = new SkillsError('something broke', 'GENERIC');
    expect(err.name).toBe('SkillsError');
    expect(err.code).toBe('GENERIC');
    expect(err.message).toBe('something broke');
  });

  it('extends Error', () => {
    const err = new SkillsError('test', 'TEST');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SkillsError);
  });
});

describe('SkillNotFoundError', () => {
  it('sets properties with a skillId', () => {
    const err = new SkillNotFoundError('skill-123');
    expect(err.name).toBe('SkillNotFoundError');
    expect(err.code).toBe('SKILL_NOT_FOUND');
    expect(err.message).toBe('Skill not found: skill-123');
    expect(err.skillId).toBe('skill-123');
  });

  it('handles missing skillId', () => {
    const err = new SkillNotFoundError();
    expect(err.message).toBe('Skill not found');
    expect(err.skillId).toBeUndefined();
  });

  it('extends SkillsError and Error', () => {
    const err = new SkillNotFoundError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SkillsError);
    expect(err).toBeInstanceOf(SkillNotFoundError);
  });
});

describe('VersionNotFoundError', () => {
  it('sets properties with identifier only', () => {
    const err = new VersionNotFoundError('v-42');
    expect(err.name).toBe('VersionNotFoundError');
    expect(err.code).toBe('VERSION_NOT_FOUND');
    expect(err.message).toBe('Version not found: v-42');
    expect(err.versionId).toBe('v-42');
    expect(err.skillSlug).toBeUndefined();
  });

  it('uses skillSlug in message when provided', () => {
    const err = new VersionNotFoundError('v-42', { skillSlug: 'my-skill' });
    expect(err.message).toBe('No version found for skill my-skill');
    expect(err.versionId).toBe('v-42');
    expect(err.skillSlug).toBe('my-skill');
  });

  it('extends SkillsError and Error', () => {
    const err = new VersionNotFoundError('v-1');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SkillsError);
    expect(err).toBeInstanceOf(VersionNotFoundError);
  });
});

describe('RemoteSkillNotFoundError', () => {
  it('sets properties', () => {
    const err = new RemoteSkillNotFoundError('remote-99');
    expect(err.name).toBe('RemoteSkillNotFoundError');
    expect(err.code).toBe('REMOTE_SKILL_NOT_FOUND');
    expect(err.message).toBe('Remote skill not found: remote-99');
    expect(err.remoteId).toBe('remote-99');
  });

  it('extends SkillsError and Error', () => {
    const err = new RemoteSkillNotFoundError('r-1');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SkillsError);
    expect(err).toBeInstanceOf(RemoteSkillNotFoundError);
  });
});

describe('RemoteApiError', () => {
  it('sets properties with responseBody', () => {
    const err = new RemoteApiError('gateway timeout', 504, '{"error":"timeout"}');
    expect(err.name).toBe('RemoteApiError');
    expect(err.code).toBe('REMOTE_API_ERROR');
    expect(err.message).toBe('gateway timeout');
    expect(err.statusCode).toBe(504);
    expect(err.responseBody).toBe('{"error":"timeout"}');
  });

  it('handles missing responseBody', () => {
    const err = new RemoteApiError('not found', 404);
    expect(err.statusCode).toBe(404);
    expect(err.responseBody).toBeUndefined();
  });

  it('extends SkillsError and Error', () => {
    const err = new RemoteApiError('fail', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SkillsError);
    expect(err).toBeInstanceOf(RemoteApiError);
  });
});

describe('AnalysisError', () => {
  it('sets properties with statusCode', () => {
    const err = new AnalysisError('analysis failed', 422);
    expect(err.name).toBe('AnalysisError');
    expect(err.code).toBe('ANALYSIS_ERROR');
    expect(err.message).toBe('analysis failed');
    expect(err.statusCode).toBe(422);
  });

  it('handles missing statusCode', () => {
    const err = new AnalysisError('unknown failure');
    expect(err.statusCode).toBeUndefined();
  });

  it('extends SkillsError and Error', () => {
    const err = new AnalysisError('fail');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SkillsError);
    expect(err).toBeInstanceOf(AnalysisError);
  });
});

describe('BackupTamperError', () => {
  it('sets properties', () => {
    const err = new BackupTamperError('v-77');
    expect(err.name).toBe('BackupTamperError');
    expect(err.code).toBe('BACKUP_TAMPERED');
    expect(err.message).toBe('Backup files for version v-77 have been tampered with');
    expect(err.versionId).toBe('v-77');
  });

  it('extends SkillsError and Error', () => {
    const err = new BackupTamperError('v-1');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SkillsError);
    expect(err).toBeInstanceOf(BackupTamperError);
  });
});
