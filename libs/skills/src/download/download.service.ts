/**
 * Download service — Fetch skills from remote marketplace and store locally.
 *
 * This is the first phase of the two-phase workflow:
 * 1. **Download** — fetch, analyze, store as trusted in the DB (this service)
 * 2. **Install** — deploy to a specific target/user (InstallService)
 *
 * A downloaded skill has a Skill record, a SkillVersion, and registered file
 * hashes, but NO SkillInstallation is created.
 */

import * as crypto from 'node:crypto';
import type { Skill, SkillVersion } from '@agenshield/ipc';
import type { SkillsRepository } from '@agenshield/storage';
import type { RemoteSkillClient } from '../remote/types';
import type { EventEmitter } from 'node:events';
import type { SkillEvent } from '../events';
import type { SkillBackupService } from '../backup';
import type { AnalyzeService } from '../analyze/analyze.service';
import type { DownloadParams, DownloadResult } from './types';
import { RemoteSkillNotFoundError, SkillsError } from '../errors';

export class DownloadService {
  constructor(
    private readonly skills: SkillsRepository,
    private readonly remote: RemoteSkillClient | null,
    private readonly emitter: EventEmitter,
    private readonly backup: SkillBackupService | null,
    private readonly analyzer?: AnalyzeService,
  ) {}

  private emit(event: SkillEvent): void {
    this.emitter.emit('skill-event', event);
  }

  /**
   * Download a skill from the remote marketplace and store it locally.
   *
   * If the skill already exists in the DB (by slug), returns the existing
   * record instead of re-downloading.
   */
  async download(params: DownloadParams): Promise<DownloadResult> {
    const operationId = crypto.randomUUID();

    if (!params.slug && !params.remoteId) {
      throw new SkillsError('Either slug or remoteId is required for download', 'DOWNLOAD_INVALID_PARAMS');
    }

    if (!this.remote) {
      throw new SkillsError('Remote client unavailable (offline mode)', 'DOWNLOAD_OFFLINE');
    }

    const identifier = params.slug ?? params.remoteId!;

    try {
      // Check if already downloaded (exists in local DB by slug)
      if (params.slug) {
        const existing = this.skills.getBySlug(params.slug);
        if (existing) {
          const version = this.skills.getLatestVersion(existing.id);
          if (version) {
            return { skill: existing, version };
          }
        }
      }

      this.emit({
        type: 'download:started',
        operationId,
        skillSlug: identifier,
        remoteId: params.remoteId ?? identifier,
      });

      // Fetch skill descriptor from marketplace
      const descriptor = await this.remote.getSkill(identifier);
      if (!descriptor) {
        throw new RemoteSkillNotFoundError(identifier);
      }

      // Download files
      this.emit({
        type: 'download:progress',
        progress: {
          operationId,
          skillSlug: descriptor.slug,
          step: 'downloading',
          stepIndex: 0,
          totalSteps: 3,
          message: `Downloading ${descriptor.slug}...`,
        },
      });

      const { version: dlVersion, checksum } = await this.remote.download(
        params.remoteId ?? identifier,
        params.version,
      );

      // Create local skill record
      this.emit({
        type: 'download:extracting',
        progress: {
          operationId,
          skillSlug: descriptor.slug,
          step: 'registering',
          stepIndex: 1,
          totalSteps: 3,
          message: 'Registering skill in local database...',
        },
      });

      const skill = this.skills.create({
        name: descriptor.name,
        slug: descriptor.slug,
        author: descriptor.author,
        description: descriptor.description,
        tags: descriptor.tags,
        source: 'marketplace',
        remoteId: descriptor.remoteId,
        isPublic: true,
      });

      // Create version record
      const version = this.skills.addVersion({
        skillId: skill.id,
        version: dlVersion,
        folderPath: `/skills/${descriptor.slug}/${dlVersion}`,
        contentHash: checksum,
        hashUpdatedAt: new Date().toISOString(),
        approval: 'unknown',
        trusted: false,
        analysisStatus: 'pending',
        requiredBins: [],
        requiredEnv: [],
        extractedCommands: [],
      });

      this.emit({
        type: 'download:completed',
        operationId,
        skillSlug: descriptor.slug,
        version: dlVersion,
      });

      // Optionally trigger analysis
      if (params.analyze && this.analyzer) {
        try {
          await this.analyzer.analyzeVersion(version.id);
        } catch {
          // Analysis failure is non-fatal for download
        }
      }

      return { skill, version };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({
        type: 'download:error',
        operationId,
        skillSlug: identifier,
        error: errorMsg,
      });
      throw err;
    }
  }
}
