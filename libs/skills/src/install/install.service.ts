/**
 * Install service — Install/uninstall skills, manage auto-update settings.
 *
 * The skill MUST already exist in the local DB (from a prior download or upload).
 * Remote downloading is handled by DownloadService.
 */

import type { Skill, SkillVersion, SkillInstallation } from '@agenshield/ipc';
import type { SkillsRepository } from '@agenshield/storage';
import type { RemoteSkillClient } from '../remote/types';
import type { EventEmitter } from 'node:events';
import type { SkillEvent } from '../events';
import type { InstallParams } from './types';
import type { DeployService } from '../deploy/deploy.service';
import { SkillNotFoundError, VersionNotFoundError } from '../errors';
import * as crypto from 'node:crypto';

export class InstallService {
  constructor(
    private readonly skills: SkillsRepository,
    private readonly remote: RemoteSkillClient | null,
    private readonly emitter: EventEmitter,
    private readonly deployer?: DeployService,
  ) {}

  private emit(event: SkillEvent): void {
    this.emitter.emit('skill-event', event);
  }

  async install(params: InstallParams): Promise<SkillInstallation> {
    const operationId = crypto.randomUUID();
    let skill: Skill | null = null;
    let version: SkillVersion | null = null;

    try {
      // Resolve skill from local DB — by skillId, remoteId, or slug
      if (params.skillId) {
        skill = this.skills.getById(params.skillId);
      }
      if (!skill && params.remoteId) {
        skill = this.skills.getByRemoteId(params.remoteId);
      }
      if (!skill && params.slug) {
        skill = this.skills.getBySlug(params.slug);
      }

      if (!skill) throw new SkillNotFoundError(params.skillId ?? params.remoteId ?? params.slug);

      const skillSlug = skill.slug;
      this.emit({
        type: 'install:started',
        operationId,
        skillSlug,
        profileId: params.profileId,
      });

      // Resolve version
      version = params.version
        ? this.skills.getVersion({ skillId: skill.id, version: params.version })
        : this.skills.getLatestVersion(skill.id);

      if (!version) throw new VersionNotFoundError(params.version ?? 'latest', { skillSlug: skill.slug });

      // Create installation
      this.emit({
        type: 'install:creating',
        progress: {
          operationId, skillSlug,
          step: 'creating-installation', stepIndex: 1, totalSteps: 2,
          message: 'Creating installation...',
        },
      });

      // Check if a deployer adapter matches this target
      const hasDeployer = this.deployer?.findAdapter(params.profileId) != null;

      const installation = this.skills.install({
        skillVersionId: version.id,
        profileId: params.profileId,
        status: hasDeployer ? 'pending' : 'active',
        autoUpdate: params.autoUpdate ?? true,
      });

      // Deploy to filesystem if adapter available
      if (hasDeployer && this.deployer) {
        try {
          const result = await this.deployer.deploy(installation, version, skill);
          this.skills.updateInstallationStatus(installation.id, { status: 'active' });
          installation.status = 'active';
          if (result?.wrapperPath) {
            this.skills.updateWrapperPath(installation.id, result.wrapperPath);
            installation.wrapperPath = result.wrapperPath;
          }
        } catch (deployErr) {
          this.skills.updateInstallationStatus(installation.id, { status: 'disabled' });
          installation.status = 'disabled';
          throw deployErr;
        }
      }

      this.emit({ type: 'install:completed', operationId, installation });
      return installation;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({
        type: 'install:error',
        operationId,
        skillSlug: skill?.slug ?? params.skillId ?? params.remoteId ?? 'unknown',
        error: errorMsg,
      });
      throw err;
    }
  }

  async uninstall(installationId: string): Promise<boolean> {
    const operationId = crypto.randomUUID();
    this.emit({ type: 'uninstall:started', operationId, installationId });

    try {
      // Undeploy from filesystem before deleting DB record
      if (this.deployer) {
        const inst = this.skills.getInstallationById(installationId);
        if (inst) {
          const version = this.skills.getVersionById(inst.skillVersionId);
          if (version) {
            const skill = this.skills.getById(version.skillId);
            if (skill) {
              await this.deployer.undeploy(inst, version, skill).catch(() => { /* best-effort */ });
            }
          }
        }
      }

      const result = this.skills.uninstall(installationId);
      this.emit({ type: 'uninstall:completed', operationId, installationId });
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'uninstall:error', operationId, installationId, error: errorMsg });
      throw err;
    }
  }

  setAutoUpdate(installationId: string, enabled: boolean): void {
    this.skills.setAutoUpdate(installationId, enabled);
  }

  pinVersion(installationId: string, version: string): void {
    this.skills.pinVersion(installationId, version);
  }

  unpinVersion(installationId: string): void {
    this.skills.unpinVersion(installationId);
  }
}
