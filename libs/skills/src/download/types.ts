/**
 * Download service types
 */

import type { Skill, SkillVersion } from '@agenshield/ipc';

export interface DownloadParams {
  /** Remote skill slug (marketplace lookup) */
  slug?: string;
  /** Remote skill ID (direct download) */
  remoteId?: string;
  /** Specific version to download (defaults to latest) */
  version?: string;
  /** Trigger analysis after download (default: false) */
  analyze?: boolean;
}

export interface DownloadResult {
  skill: Skill;
  version: SkillVersion;
}
