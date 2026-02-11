/**
 * Upload service — Create skills from zip or directory
 */

import type { SkillsRepository } from '@agenshield/storage';
import type { EventEmitter } from 'node:events';
import type { SkillEvent } from '../events';
import type { UploadFromZipParams, UploadResult } from './types';
import * as crypto from 'node:crypto';

export class UploadService {
  constructor(
    private readonly skills: SkillsRepository,
    private readonly emitter: EventEmitter,
  ) {}

  private emit(event: SkillEvent): void {
    this.emitter.emit('skill-event', event);
  }

  uploadFromFiles(params: UploadFromZipParams): UploadResult {
    const operationId = crypto.randomUUID();
    this.emit({ type: 'upload:started', operationId, skillSlug: params.slug });

    try {
      // Hash files
      this.emit({
        type: 'upload:hashing',
        progress: {
          operationId, skillSlug: params.slug,
          step: 'computing-hashes', stepIndex: 0, totalSteps: 3,
          message: 'Computing file hashes...',
        },
      });

      const fileEntries = params.files.map((f) => ({
        relativePath: f.relativePath,
        fileHash: crypto.createHash('sha256').update(f.content).digest('hex'),
        sizeBytes: f.content.length,
      }));

      // Compute content hash
      const sortedHashes = fileEntries
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        .map((f) => f.fileHash)
        .join('');
      const contentHash = crypto.createHash('sha256').update(sortedHashes).digest('hex');

      // Create or get skill
      let skill = this.skills.getBySlug(params.slug);
      if (!skill) {
        skill = this.skills.create({
          name: params.name,
          slug: params.slug,
          author: params.author,
          description: params.description,
          tags: params.tags ?? [],
          source: 'manual',
        });
        this.emit({ type: 'skill:created', skill });
      }

      // Register files
      this.emit({
        type: 'upload:registering',
        progress: {
          operationId, skillSlug: params.slug,
          step: 'registering-files', stepIndex: 1, totalSteps: 3,
          message: `Registering ${fileEntries.length} files...`,
        },
      });

      const version = this.skills.addVersion({
        skillId: skill.id,
        version: params.version,
        folderPath: `/skills/${params.slug}/${params.version}`,
        contentHash,
        hashUpdatedAt: new Date().toISOString(),
        approval: 'unknown',
        trusted: false,
        analysisStatus: 'pending',
        requiredBins: [],
        requiredEnv: [],
        extractedCommands: [],
      });

      this.skills.registerFiles({
        versionId: version.id,
        files: fileEntries,
      });

      this.emit({ type: 'version:created', version });
      this.emit({ type: 'upload:completed', operationId, skill, version });

      return { skill, version };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'upload:error', operationId, skillSlug: params.slug, error: errorMsg });
      throw err;
    }
  }
}
