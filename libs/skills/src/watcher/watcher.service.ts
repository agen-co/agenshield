/**
 * Skill watcher service — polling-based integrity monitor for deployed skills
 */

import * as crypto from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { SkillsRepository } from '@agenshield/storage';
import type { SkillEvent } from '../events';
import type { DeployService } from '../deploy';
import type { WatcherOptions, WatcherPolicy, ResolvedWatcherPolicy, WatcherAction } from './types';

const DEFAULT_POLL_INTERVAL = 30_000;
const DEFAULT_POLICY: ResolvedWatcherPolicy = { onModified: 'quarantine', onDeleted: 'quarantine' };

export class SkillWatcherService {
  private readonly skills: SkillsRepository;
  private readonly deployer: DeployService;
  private readonly emitter: EventEmitter;
  private readonly pollIntervalMs: number;
  private readonly defaultPolicy: ResolvedWatcherPolicy;
  private readonly installationPolicies: Map<string, Partial<WatcherPolicy>>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(skills: SkillsRepository, deployer: DeployService, emitter: EventEmitter, options?: WatcherOptions) {
    this.skills = skills;
    this.deployer = deployer;
    this.emitter = emitter;
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    this.defaultPolicy = {
      onModified: options?.defaultPolicy?.onModified ?? DEFAULT_POLICY.onModified,
      onDeleted: options?.defaultPolicy?.onDeleted ?? DEFAULT_POLICY.onDeleted,
    };
    this.installationPolicies = new Map(
      options?.installationPolicies ? Object.entries(options.installationPolicies) : [],
    );
  }

  private emit(event: SkillEvent): void {
    this.emitter.emit('skill-event', event);
  }

  /** Resolve the effective policy for an installation (per-installation overrides merged with defaults) */
  resolvePolicy(installationId: string): ResolvedWatcherPolicy {
    const override = this.installationPolicies.get(installationId);
    if (!override) return { ...this.defaultPolicy };
    return {
      onModified: override.onModified ?? this.defaultPolicy.onModified,
      onDeleted: override.onDeleted ?? this.defaultPolicy.onDeleted,
    };
  }

  /** Set a per-installation policy override */
  setInstallationPolicy(id: string, policy: Partial<WatcherPolicy>): void {
    this.installationPolicies.set(id, policy);
  }

  /** Remove a per-installation policy override */
  removeInstallationPolicy(id: string): void {
    this.installationPolicies.delete(id);
  }

  /** Start the polling loop */
  start(): void {
    if (this.timer) return;
    this.emit({ type: 'watcher:started', pollIntervalMs: this.pollIntervalMs });
    this.timer = setInterval(() => { this.poll().catch(() => { /* handled internally */ }); }, this.pollIntervalMs);
  }

  /** Stop the polling loop */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.emit({ type: 'watcher:stopped' });
  }

  /** Whether the watcher is currently running */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** Execute a single integrity scan cycle */
  async poll(): Promise<void> {
    const operationId = crypto.randomUUID();
    this.emit({ type: 'watcher:poll-started', operationId });

    try {
      const checks = await this.deployer.checkAllIntegrity();
      let violationCount = 0;

      for (const check of checks) {
        if (check.result.intact) continue;
        violationCount++;

        const policy = this.resolvePolicy(check.installationId);
        const hasModified = check.result.modifiedFiles.length > 0 || check.result.unexpectedFiles.length > 0;
        const hasDeleted = check.result.missingFiles.length > 0;

        // Determine action: if both types, use stricter (quarantine > reinstall)
        let action: WatcherAction;
        if (hasModified && hasDeleted) {
          action = policy.onModified === 'quarantine' || policy.onDeleted === 'quarantine' ? 'quarantine' : 'reinstall';
        } else if (hasDeleted) {
          action = policy.onDeleted;
        } else {
          action = policy.onModified;
        }

        this.emit({
          type: 'watcher:integrity-violation',
          operationId,
          installationId: check.installationId,
          adapterId: check.adapterId,
          modifiedFiles: check.result.modifiedFiles,
          missingFiles: check.result.missingFiles,
          unexpectedFiles: check.result.unexpectedFiles,
          action,
        });

        try {
          if (action === 'quarantine') {
            this.skills.updateInstallationStatus(check.installationId, { status: 'quarantined' });
            this.emit({ type: 'watcher:quarantined', operationId, installationId: check.installationId });
          } else {
            // reinstall — look up installation, version, skill and redeploy
            const inst = this.skills.getInstallationById(check.installationId);
            if (inst) {
              const version = this.skills.getVersionById(inst.skillVersionId);
              if (version) {
                const skill = this.skills.getById(version.skillId);
                if (skill) {
                  await this.deployer.deploy(inst, version, skill);
                  this.emit({ type: 'watcher:reinstalled', operationId, installationId: check.installationId });
                }
              }
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.emit({
            type: 'watcher:action-error',
            operationId,
            installationId: check.installationId,
            action,
            error: errorMsg,
          });
        }
      }

      this.emit({ type: 'watcher:poll-completed', operationId, checkedCount: checks.length, violationCount });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'watcher:error', error: errorMsg });
    }
  }
}
