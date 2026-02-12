/**
 * Upload service types
 */

import type { Skill, SkillVersion } from '@agenshield/ipc';

export interface UploadFromZipParams {
  name: string;
  slug: string;
  version: string;
  author?: string;
  description?: string;
  tags?: string[];
  source?: 'marketplace' | 'watcher' | 'manual' | 'integration' | 'unknown';
  files: Array<{ relativePath: string; content: Buffer }>;
}

export interface UploadResult {
  skill: Skill;
  version: SkillVersion;
}
