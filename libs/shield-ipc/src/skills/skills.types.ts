/**
 * Skill domain types
 *
 * Skills are agent capabilities (MCP servers, CLI tools, etc.) that can be
 * installed, versioned, analyzed, and monitored for changes.
 */

export type SkillSource = 'marketplace' | 'watcher' | 'manual' | 'integration' | 'unknown';
export type SkillApproval = 'approved' | 'quarantined' | 'unknown';
export type AnalysisStatus = 'pending' | 'analyzing' | 'complete' | 'error';
export type InstallationStatus = 'active' | 'disabled' | 'quarantined' | 'pending';

/** A skill identity — one record per unique skill (shared across tenants) */
export interface Skill {
  id: string;
  name: string;
  slug: string;
  author?: string;
  description?: string;
  homepage?: string;
  tags: string[];
  source: SkillSource;
  remoteId?: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A specific version of a skill — files live at /skills/{slug}/{version}/ */
export interface SkillVersion {
  id: string;
  skillId: string;
  version: string;
  folderPath: string;

  contentHash: string;
  hashUpdatedAt: string;

  approval: SkillApproval;
  approvedAt?: string;
  trusted: boolean;

  metadataJson?: unknown;

  analysisStatus: AnalysisStatus;
  analysisJson?: unknown;
  analyzedAt?: string;

  requiredBins: string[];
  requiredEnv: string[];
  extractedCommands: unknown[];

  /** SHA-256 hash of backup files for tamper detection */
  backupHash?: string;

  createdAt: string;
  updatedAt: string;
}

/** Individual file within a skill version — for change monitoring */
export interface SkillFile {
  id: string;
  skillVersionId: string;
  relativePath: string;
  fileHash: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

/** Where a skill version is installed (per target/user) */
export interface SkillInstallation {
  id: string;
  skillVersionId: string;
  targetId?: string;
  userUsername?: string;
  status: InstallationStatus;
  wrapperPath?: string;
  autoUpdate: boolean;
  pinnedVersion?: string;
  installedAt: string;
  updatedAt: string;
}
