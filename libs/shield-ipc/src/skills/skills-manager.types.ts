/**
 * Skills Manager types — shared types for the skill lifecycle manager
 */

import type { Skill, SkillVersion, SkillInstallation } from './skills.types';

/** Combined search result from local DB and/or remote marketplace */
export interface SkillSearchResult {
  skill: Skill;
  latestVersion?: SkillVersion;
  installed?: SkillInstallation;
  source: 'local' | 'remote';
}

/** Descriptor for a skill available on the remote marketplace */
export interface RemoteSkillDescriptor {
  remoteId: string;
  name: string;
  slug: string;
  author?: string;
  description?: string;
  tags: string[];
  latestVersion: string;
  downloadUrl: string;
  checksum: string;
}

/** Result of analyzing a skill version */
export interface AnalysisResult {
  status: 'success' | 'error';
  data?: unknown;
  requiredBins: string[];
  requiredEnv: string[];
  extractedCommands: string[];
  error?: string;
}

/** Result of checking a single skill for available updates */
export interface UpdateCheckResult {
  skill: Skill;
  currentVersion: string;
  availableVersion: string;
  autoUpdateEnabled: boolean;
  installationsAffected: number;
}

/** Result of applying an update to a skill */
export interface UpdateResult {
  skillId: string;
  fromVersionId: string;
  toVersionId: string;
  installationsUpdated: number;
  errors: string[];
}

/** Upload metadata for publishing a skill */
export interface UploadMetadata {
  name: string;
  slug: string;
  version: string;
  author?: string;
  description?: string;
  tags?: string[];
}

/** Response from a remote search */
export interface RemoteSearchResponse {
  results: RemoteSkillDescriptor[];
  total: number;
  page: number;
  pageSize: number;
}

/** Result of a version check against remote */
export interface VersionCheckResult {
  remoteId: string;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  checksum: string;
}
