/**
 * Deploy adapter types — pluggable deployers for different deployment targets
 */

import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';

/** Context passed to deploy adapters with all relevant skill data */
export interface DeployContext {
  skill: Skill;
  version: SkillVersion;
  files: SkillFile[];
  installation: SkillInstallation;
  /** Backup file content keyed by relativePath. Fallback when disk files are missing. */
  fileContents?: Map<string, Buffer>;
}

/** Result of a successful deployment */
export interface DeployResult {
  wrapperPath?: string;
  deployedPath: string;
  deployedHash: string;
}

/** Result of an integrity check against deployed files */
export interface IntegrityCheckResult {
  intact: boolean;
  modifiedFiles: string[];
  missingFiles: string[];
  unexpectedFiles: string[];
  currentHash?: string;
  expectedHash?: string;
}

/**
 * Deploy adapter interface — each adapter handles a specific deployment target.
 * Adapters are responsible for copying files, creating wrappers, and verifying integrity.
 */
export interface DeployAdapter {
  readonly id: string;
  readonly displayName: string;

  /** Returns true if this adapter can handle the given profile ID */
  canDeploy(profileId: string | undefined): boolean;

  /** Deploy a skill version to the target filesystem */
  deploy(context: DeployContext): Promise<DeployResult>;

  /** Remove a deployed skill from the target filesystem */
  undeploy(installation: SkillInstallation, version: SkillVersion, skill: Skill): Promise<void>;

  /** Check integrity of deployed files against the registered file manifests */
  checkIntegrity(installation: SkillInstallation, version: SkillVersion, files: SkillFile[]): Promise<IntegrityCheckResult>;
}
