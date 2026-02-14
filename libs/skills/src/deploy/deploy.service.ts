/**
 * Deploy service — orchestrates deploy adapters for filesystem operations
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { SkillsRepository } from '@agenshield/storage';
import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';
import type { SkillEvent } from '../events';
import type { DeployAdapter, DeployResult, IntegrityCheckResult } from './types';
import type { SkillBackupService } from '../backup';

export class DeployService {
  private readonly adapters: DeployAdapter[];
  private readonly skills: SkillsRepository;
  private readonly emitter: EventEmitter;
  private readonly backup: SkillBackupService | null;

  constructor(skills: SkillsRepository, adapters: DeployAdapter[], emitter: EventEmitter, backup?: SkillBackupService | null) {
    this.skills = skills;
    this.adapters = adapters;
    this.emitter = emitter;
    this.backup = backup ?? null;
  }

  private emit(event: SkillEvent): void {
    this.emitter.emit('skill-event', event);
  }

  /** Find an adapter that can handle the given profile ID */
  findAdapter(profileId: string | undefined): DeployAdapter | null {
    return this.adapters.find((a) => a.canDeploy(profileId)) ?? null;
  }

  /** Deploy a skill installation using the matching adapter */
  async deploy(installation: SkillInstallation, version: SkillVersion, skill: Skill): Promise<DeployResult | null> {
    const adapter = this.findAdapter(installation.profileId);
    if (!adapter) return null;

    const operationId = crypto.randomUUID();
    const files = this.skills.getFiles(version.id);
    const fileContents = this.backup?.loadFiles(version.id);

    this.emit({
      type: 'deploy:started',
      operationId,
      installationId: installation.id,
      adapterId: adapter.id,
      skillSlug: skill.slug,
    });

    try {
      const result = await adapter.deploy({ skill, version, files, installation, fileContents });

      // Sync DB file hashes with deployed content (adapter may modify files during deploy)
      this.syncFileHashes(result.deployedPath, files, version.id);

      this.emit({
        type: 'deploy:completed',
        operationId,
        installationId: installation.id,
        adapterId: adapter.id,
        result,
      });

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({
        type: 'deploy:error',
        operationId,
        installationId: installation.id,
        adapterId: adapter.id,
        error: errorMsg,
      });
      throw err;
    }
  }

  /** Undeploy a skill installation using the matching adapter */
  async undeploy(installation: SkillInstallation, version: SkillVersion, skill: Skill): Promise<void> {
    const adapter = this.findAdapter(installation.profileId);
    if (!adapter) return;

    const operationId = crypto.randomUUID();

    this.emit({
      type: 'undeploy:started',
      operationId,
      installationId: installation.id,
      adapterId: adapter.id,
    });

    try {
      await adapter.undeploy(installation, version, skill);

      this.emit({
        type: 'undeploy:completed',
        operationId,
        installationId: installation.id,
        adapterId: adapter.id,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({
        type: 'undeploy:error',
        operationId,
        installationId: installation.id,
        adapterId: adapter.id,
        error: errorMsg,
      });
      throw err;
    }
  }

  /** Check integrity of a single installation */
  async checkIntegrity(installationId: string): Promise<{ adapterId: string; result: IntegrityCheckResult } | null> {
    const inst = this.skills.getInstallationById(installationId);
    if (!inst || inst.status !== 'active') return null;

    const adapter = this.findAdapter(inst.profileId);
    if (!adapter) return null;

    const version = this.skills.getVersionById(inst.skillVersionId);
    if (!version) return null;

    const files = this.skills.getFiles(version.id);
    const result = await adapter.checkIntegrity(inst, version, files);
    return { adapterId: adapter.id, result };
  }

  /** Check integrity of all active installations */
  async checkAllIntegrity(): Promise<Array<{ installationId: string; adapterId: string; result: IntegrityCheckResult }>> {
    const installations = this.skills.getInstallations();
    const active = installations.filter((i) => i.status === 'active');
    const results: Array<{ installationId: string; adapterId: string; result: IntegrityCheckResult }> = [];

    for (const inst of active) {
      const adapter = this.findAdapter(inst.profileId);
      if (!adapter) continue;

      const version = this.skills.getVersionById(inst.skillVersionId);
      if (!version) continue;

      const files = this.skills.getFiles(version.id);
      const result = await adapter.checkIntegrity(inst, version, files);

      results.push({ installationId: inst.id, adapterId: adapter.id, result });
    }

    return results;
  }

  /**
   * Re-read deployed files and update DB hashes for any that differ.
   * Adapters like DaemonDeployAdapter may modify file content during deploy
   * (e.g. stripping env vars, injecting tags), causing the on-disk hash to
   * diverge from the original upload hash stored in the DB. Without this sync,
   * every subsequent integrity check would report a false modification.
   */
  private syncFileHashes(deployedPath: string, files: SkillFile[], versionId: string): void {
    let changed = false;
    for (const file of files) {
      const filePath = path.join(deployedPath, file.relativePath);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (hash !== file.fileHash) {
        this.skills.updateFileHash({ fileId: file.id, newHash: hash });
        changed = true;
      }
    }
    if (changed) {
      this.skills.recomputeContentHash(versionId);
    }
  }
}
