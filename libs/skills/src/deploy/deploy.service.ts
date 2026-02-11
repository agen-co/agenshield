/**
 * Deploy service — orchestrates deploy adapters for filesystem operations
 */

import * as crypto from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { SkillsRepository } from '@agenshield/storage';
import type { Skill, SkillVersion, SkillInstallation } from '@agenshield/ipc';
import type { SkillEvent } from '../events';
import type { DeployAdapter, DeployResult, IntegrityCheckResult } from './types';

export class DeployService {
  private readonly adapters: DeployAdapter[];
  private readonly skills: SkillsRepository;
  private readonly emitter: EventEmitter;

  constructor(skills: SkillsRepository, adapters: DeployAdapter[], emitter: EventEmitter) {
    this.skills = skills;
    this.adapters = adapters;
    this.emitter = emitter;
  }

  private emit(event: SkillEvent): void {
    this.emitter.emit('skill-event', event);
  }

  /** Find an adapter that can handle the given target ID */
  findAdapter(targetId: string | undefined): DeployAdapter | null {
    return this.adapters.find((a) => a.canDeploy(targetId)) ?? null;
  }

  /** Deploy a skill installation using the matching adapter */
  async deploy(installation: SkillInstallation, version: SkillVersion, skill: Skill): Promise<DeployResult | null> {
    const adapter = this.findAdapter(installation.targetId);
    if (!adapter) return null;

    const operationId = crypto.randomUUID();
    const files = this.skills.getFiles(version.id);

    this.emit({
      type: 'deploy:started',
      operationId,
      installationId: installation.id,
      adapterId: adapter.id,
      skillSlug: skill.slug,
    });

    try {
      const result = await adapter.deploy({ skill, version, files, installation });

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
    const adapter = this.findAdapter(installation.targetId);
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

  /** Check integrity of all active installations */
  async checkAllIntegrity(): Promise<Array<{ installationId: string; adapterId: string; result: IntegrityCheckResult }>> {
    const installations = this.skills.getInstallations();
    const active = installations.filter((i) => i.status === 'active');
    const results: Array<{ installationId: string; adapterId: string; result: IntegrityCheckResult }> = [];

    for (const inst of active) {
      const adapter = this.findAdapter(inst.targetId);
      if (!adapter) continue;

      const version = this.skills.getVersionById(inst.skillVersionId);
      if (!version) continue;

      const files = this.skills.getFiles(version.id);
      const result = await adapter.checkIntegrity(inst, version, files);

      results.push({ installationId: inst.id, adapterId: adapter.id, result });
    }

    return results;
  }
}
