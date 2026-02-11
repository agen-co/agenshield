/**
 * SkillManager — Main entry point for skill lifecycle management
 */

import { EventEmitter } from 'node:events';
import type { Storage } from '@agenshield/storage';
import type {
  Skill,
  SkillVersion,
  SkillInstallation,
  SkillSearchResult,
  AnalysisResult,
  UpdateCheckResult,
  UpdateResult,
  EventBus,
} from '@agenshield/ipc';
import type { RemoteSkillClient } from './remote/types';
import type { AnalyzeAdapter } from './analyze/types';
import type { DeployAdapter } from './deploy/types';
import { DefaultRemoteClient } from './remote/client';
import { CatalogService } from './catalog/catalog.service';
import { LocalSearchAdapter } from './catalog/adapters/local.adapter';
import { RemoteSearchAdapter } from './catalog/adapters/remote.adapter';
import type { SearchAdapter } from './catalog/types';
import { InstallService } from './install/install.service';
import type { InstallParams } from './install/types';
import { AnalyzeService } from './analyze/analyze.service';
import { BasicAnalyzeAdapter } from './analyze/adapters/basic.adapter';
import { UploadService } from './upload/upload.service';
import type { UploadFromZipParams, UploadResult } from './upload/types';
import { UpdateService } from './update/update.service';
import { DeployService } from './deploy/deploy.service';
import { SkillWatcherService } from './watcher/watcher.service';
import type { WatcherOptions } from './watcher/types';
import type { SkillEvent } from './events';

/** @deprecated Use AnalyzeAdapter instead */
export type SkillAnalyzer = AnalyzeAdapter;

export interface SkillManagerOptions {
  remoteUrl?: string;
  remoteClient?: RemoteSkillClient;
  /** Array of analyze adapters. Overrides `analyzer`. */
  analyzers?: AnalyzeAdapter[];
  /** @deprecated Use `analyzers` instead. Single analyzer kept for backward compat. */
  analyzer?: AnalyzeAdapter;
  offlineMode?: boolean;
  /** When provided, SkillManager bridges internal events to the typed EventBus. */
  eventBus?: EventBus;
  /** Deploy adapters for filesystem deployment targets */
  deployers?: DeployAdapter[];
  /** Watcher configuration for integrity monitoring */
  watcher?: WatcherOptions;
  /** Start the watcher automatically on construction (default: false) */
  autoStartWatcher?: boolean;
}

export class SkillManager extends EventEmitter {
  readonly catalog: CatalogService;
  readonly installer: InstallService;
  readonly analyzer: AnalyzeService;
  readonly uploader: UploadService;
  readonly updater: UpdateService;
  readonly deployer: DeployService;
  readonly watcher: SkillWatcherService;

  private readonly skills: import('@agenshield/storage').SkillsRepository;

  constructor(storage: Storage, options?: SkillManagerOptions) {
    super();

    const skills = storage.skills;
    this.skills = skills;

    // Build remote client
    let remote: RemoteSkillClient | null = null;
    if (!options?.offlineMode) {
      remote = options?.remoteClient ?? new DefaultRemoteClient({ baseUrl: options?.remoteUrl });
    }

    // Build analyzer adapters
    const analyzerAdapters: AnalyzeAdapter[] =
      options?.analyzers ?? (options?.analyzer ? [options.analyzer] : [new BasicAnalyzeAdapter()]);

    // Build search adapters
    const searchAdapters: SearchAdapter[] = [new LocalSearchAdapter(skills)];
    if (remote) searchAdapters.push(new RemoteSearchAdapter(remote));

    // Build deploy + watcher services
    this.deployer = new DeployService(skills, options?.deployers ?? [], this);
    this.watcher = new SkillWatcherService(skills, this.deployer, this, options?.watcher);

    // Construct services
    this.catalog = new CatalogService(skills, searchAdapters);
    this.installer = new InstallService(skills, remote, this, this.deployer);
    this.analyzer = new AnalyzeService(skills, analyzerAdapters, this);
    this.uploader = new UploadService(skills, this);
    this.updater = new UpdateService(skills, remote, this);

    // Bridge internal SkillEvents to the typed EventBus
    if (options?.eventBus) {
      this._bridgeToEventBus(options.eventBus);
    }

    // Auto-start watcher if configured
    if (options?.autoStartWatcher) {
      this.watcher.start();
    }
  }

  private _bridgeToEventBus(bus: EventBus): void {
    this.on('skill-event', (event: SkillEvent) => {
      switch (event.type) {
        case 'install:started':
          bus.emit('skills:install_started', { name: event.skillSlug });
          break;
        case 'install:completed':
          bus.emit('skills:installed', { name: event.installation.id });
          break;
        case 'install:error':
          bus.emit('skills:install_failed', { name: event.skillSlug, error: event.error });
          break;
        case 'analyze:completed':
          bus.emit('skills:analyzed', { name: event.versionId, analysis: event.result });
          break;
        case 'analyze:error':
          bus.emit('skills:analysis_failed', { name: event.versionId, error: event.error });
          break;
        case 'uninstall:completed':
          bus.emit('skills:uninstalled', { name: event.installationId });
          break;
        case 'deploy:completed':
          bus.emit('skills:deployed', { name: event.installationId, adapterId: event.adapterId });
          break;
        case 'deploy:error':
          bus.emit('skills:deploy_failed', { name: event.installationId, error: event.error });
          break;
        case 'watcher:integrity-violation':
          bus.emit('skills:integrity_violation', { name: event.installationId, action: event.action });
          break;
      }
    });
  }

  // ---- Convenience methods (delegate to services) ----

  async install(params: InstallParams): Promise<SkillInstallation> {
    return this.installer.install(params);
  }

  async uninstall(installationId: string): Promise<boolean> {
    return this.installer.uninstall(installationId);
  }

  async search(query: string): Promise<SkillSearchResult[]> {
    return this.catalog.search(query);
  }

  uploadFiles(params: UploadFromZipParams): UploadResult {
    return this.uploader.uploadFromFiles(params);
  }

  async analyze(versionId: string): Promise<AnalysisResult> {
    return this.analyzer.analyzeVersion(versionId);
  }

  async checkUpdates(): Promise<UpdateCheckResult[]> {
    return this.updater.checkForUpdates();
  }

  async applyUpdates(): Promise<UpdateResult[]> {
    return this.updater.applyPendingUpdates();
  }

  listInstalled(): Array<Skill & { version: SkillVersion }> {
    return this.catalog.listInstalled();
  }

  getSkill(id: string): Skill | null {
    return this.catalog.getDetail(id)?.skill ?? null;
  }

  /** Start the integrity watcher */
  startWatcher(): void {
    this.watcher.start();
  }

  /** Stop the integrity watcher */
  stopWatcher(): void {
    this.watcher.stop();
  }

  // ---- High-level workflow methods (used by daemon routes) ----

  /**
   * Approve a quarantined skill: approve its version, install, and deploy.
   */
  async approveSkill(slug: string, opts?: { targetId?: string; userUsername?: string }): Promise<SkillInstallation> {
    const skill = this.skills.getBySlug(slug);
    if (!skill) throw new (await import('./errors')).SkillNotFoundError(slug);

    const version = this.skills.getLatestVersion(skill.id);
    if (!version) throw new (await import('./errors')).VersionNotFoundError('latest', { skillSlug: slug });

    // Approve the version
    this.skills.approveVersion(version.id);

    // Install and deploy
    return this.installer.install({
      skillId: skill.id,
      targetId: opts?.targetId,
      userUsername: opts?.userUsername,
    });
  }

  /**
   * Revoke an approved skill: uninstall active installation, quarantine the version.
   */
  async revokeSkill(slug: string): Promise<void> {
    const skill = this.skills.getBySlug(slug);
    if (!skill) throw new (await import('./errors')).SkillNotFoundError(slug);

    // Find active installations
    const installations = this.skills.getInstallations();
    const versions = this.skills.getVersions(skill.id);
    const versionIds = new Set(versions.map((v) => v.id));

    for (const inst of installations) {
      if (versionIds.has(inst.skillVersionId) && inst.status === 'active') {
        await this.installer.uninstall(inst.id);
      }
    }

    // Quarantine the latest version
    const version = this.skills.getLatestVersion(skill.id);
    if (version) {
      this.skills.quarantineVersion(version.id);
    }
  }

  /**
   * Reject a skill: delete the skill entirely (cascades to versions, files, installations).
   */
  async rejectSkill(slug: string): Promise<void> {
    const skill = this.skills.getBySlug(slug);
    if (!skill) throw new (await import('./errors')).SkillNotFoundError(slug);

    // Uninstall any active installations first
    const installations = this.skills.getInstallations();
    const versions = this.skills.getVersions(skill.id);
    const versionIds = new Set(versions.map((v) => v.id));

    for (const inst of installations) {
      if (versionIds.has(inst.skillVersionId)) {
        await this.installer.uninstall(inst.id).catch(() => {
          /* best-effort */
        });
      }
    }

    this.skills.delete(skill.id);
  }

  /**
   * Toggle a skill on/off. Returns whether it was enabled or disabled.
   */
  async toggleSkill(
    slug: string,
    opts?: { targetId?: string; userUsername?: string },
  ): Promise<{ action: 'enabled' | 'disabled' }> {
    const skill = this.skills.getBySlug(slug);
    if (!skill) throw new (await import('./errors')).SkillNotFoundError(slug);

    // Check for active installations
    const installations = this.skills.getInstallations();
    const versions = this.skills.getVersions(skill.id);
    const versionIds = new Set(versions.map((v) => v.id));
    const activeInst = installations.find((i) => versionIds.has(i.skillVersionId) && i.status === 'active');

    if (activeInst) {
      // Disable: uninstall
      await this.installer.uninstall(activeInst.id);
      return { action: 'disabled' };
    } else {
      // Enable: install latest approved version
      const version = this.skills.getLatestVersion(skill.id);
      if (!version) throw new (await import('./errors')).VersionNotFoundError('latest', { skillSlug: slug });

      // Approve if not already
      if (version.approval !== 'approved') {
        this.skills.approveVersion(version.id);
      }

      await this.installer.install({
        skillId: skill.id,
        targetId: opts?.targetId,
        userUsername: opts?.userUsername,
      });
      return { action: 'enabled' };
    }
  }

  /**
   * Get a skill by slug with all its versions and installations.
   */
  getSkillBySlug(slug: string): { skill: Skill; versions: SkillVersion[]; installations: SkillInstallation[] } | null {
    const skill = this.skills.getBySlug(slug);
    if (!skill) return null;

    const versions = this.skills.getVersions(skill.id);
    const allInstallations = this.skills.getInstallations();
    const versionIds = new Set(versions.map((v) => v.id));
    const installations = allInstallations.filter((i) => versionIds.has(i.skillVersionId));

    return { skill, versions, installations };
  }

  /**
   * Get the underlying SkillsRepository for direct DB access.
   */
  getRepository(): import('@agenshield/storage').SkillsRepository {
    return this.skills;
  }
}
