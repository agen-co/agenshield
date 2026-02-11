/**
 * Update service — Auto-update management
 */

import type { UpdateCheckResult, UpdateResult } from '@agenshield/ipc';
import type { SkillsRepository } from '@agenshield/storage';
import type { RemoteSkillClient } from '../remote/types';
import type { EventEmitter } from 'node:events';
import type { SkillEvent } from '../events';
import { SkillNotFoundError } from '../errors';
import * as crypto from 'node:crypto';

export class UpdateService {
  constructor(
    private readonly skills: SkillsRepository,
    private readonly remote: RemoteSkillClient | null,
    private readonly emitter: EventEmitter,
  ) {}

  private emit(event: SkillEvent): void {
    this.emitter.emit('skill-event', event);
  }

  async checkForUpdates(): Promise<UpdateCheckResult[]> {
    if (!this.remote) return [];

    const operationId = crypto.randomUUID();
    const allSkills = this.skills.getAll();
    const remoteSkills = allSkills.filter((s) => s.remoteId);

    this.emit({ type: 'update:checking', operationId, skillCount: remoteSkills.length });

    const results: UpdateCheckResult[] = [];

    for (const skill of remoteSkills) {
      if (!skill.remoteId) continue;

      const latest = this.skills.getLatestVersion(skill.id);
      if (!latest) continue;

      try {
        const check = await this.remote.checkVersion(skill.remoteId, latest.version);
        if (check) {
          const autoUpdatable = this.skills.getAutoUpdatable(skill.id);
          results.push({
            skill,
            currentVersion: latest.version,
            availableVersion: check.latestVersion,
            autoUpdateEnabled: autoUpdatable.length > 0,
            installationsAffected: autoUpdatable.length,
          });
        }
      } catch {
        // Skip skills that fail version check
      }
    }

    this.emit({ type: 'update:found', operationId, updates: results });
    return results;
  }

  propagateUpdate(skillId: string, newVersionId: string): UpdateResult {
    const skill = this.skills.getById(skillId);
    if (!skill) throw new SkillNotFoundError(skillId);

    const oldVersion = this.skills.getLatestVersion(skillId);
    const autoUpdatable = this.skills.getAutoUpdatable(skillId);
    const errors: string[] = [];
    let updated = 0;

    for (const installation of autoUpdatable) {
      try {
        this.skills.updateInstallationVersion(installation.id, newVersionId);
        updated++;
      } catch (err) {
        errors.push(`Failed to update installation ${installation.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      skillId,
      fromVersionId: oldVersion?.id ?? '',
      toVersionId: newVersionId,
      installationsUpdated: updated,
      errors,
    };
  }

  async applyPendingUpdates(): Promise<UpdateResult[]> {
    const operationId = crypto.randomUUID();
    const results: UpdateResult[] = [];

    try {
      const updates = await this.checkForUpdates();

      for (const update of updates) {
        if (!update.autoUpdateEnabled) continue;
        if (!update.skill.remoteId) continue;

        this.emit({
          type: 'update:applying',
          operationId,
          skillSlug: update.skill.slug,
          progress: {
            operationId,
            skillSlug: update.skill.slug,
            step: 'downloading-update',
            stepIndex: 0,
            totalSteps: 2,
            message: `Updating ${update.skill.slug} to ${update.availableVersion}...`,
          },
        });

        try {
          // Download new version
          const { version: dlVersion, checksum } = await this.remote!.download(
            update.skill.remoteId,
            update.availableVersion,
          );

          // Create new version record
          const newVersion = this.skills.addVersion({
            skillId: update.skill.id,
            version: dlVersion,
            folderPath: `/skills/${update.skill.slug}/${dlVersion}`,
            contentHash: checksum,
            hashUpdatedAt: new Date().toISOString(),
            approval: 'unknown',
            trusted: false,
            analysisStatus: 'pending',
            requiredBins: [],
            requiredEnv: [],
            extractedCommands: [],
          });

          // Propagate to installations
          const result = this.propagateUpdate(update.skill.id, newVersion.id);
          results.push(result);

          this.emit({
            type: 'update:skill-done',
            operationId,
            skillSlug: update.skill.slug,
            result,
          });
        } catch (err) {
          results.push({
            skillId: update.skill.id,
            fromVersionId: '',
            toVersionId: '',
            installationsUpdated: 0,
            errors: [err instanceof Error ? err.message : String(err)],
          });
        }
      }

      this.emit({ type: 'update:completed', operationId, results });
    } catch (err) {
      this.emit({ type: 'update:error', operationId, error: err instanceof Error ? err.message : String(err) });
    }

    return results;
  }
}
