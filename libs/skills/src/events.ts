/**
 * Skill lifecycle event types with progress tracking
 */

import type { Skill, SkillVersion, SkillInstallation, UpdateCheckResult, UpdateResult } from '@agenshield/ipc';
import type { DeployResult } from './deploy';
import type { WatcherAction } from './watcher';

export interface ProgressInfo {
  operationId: string;
  skillSlug: string;
  step: string;
  stepIndex: number;
  totalSteps: number;
  percent?: number;
  bytesTransferred?: number;
  bytesTotal?: number;
  message?: string;
}

export type SkillEvent =
  // Download
  | { type: 'download:started'; operationId: string; skillSlug: string; remoteId: string }
  | { type: 'download:progress'; progress: ProgressInfo }
  | { type: 'download:extracting'; progress: ProgressInfo }
  | { type: 'download:completed'; operationId: string; skillSlug: string; version: string }
  | { type: 'download:error'; operationId: string; skillSlug: string; error: string }
  // Upload
  | { type: 'upload:started'; operationId: string; skillSlug: string }
  | { type: 'upload:extracting'; progress: ProgressInfo }
  | { type: 'upload:hashing'; progress: ProgressInfo }
  | { type: 'upload:registering'; progress: ProgressInfo }
  | { type: 'upload:uploading'; progress: ProgressInfo }
  | { type: 'upload:completed'; operationId: string; skill: Skill; version: SkillVersion }
  | { type: 'upload:error'; operationId: string; skillSlug: string; error: string }
  // Install
  | { type: 'install:started'; operationId: string; skillSlug: string; targetId?: string; userUsername?: string }
  | { type: 'install:downloading'; progress: ProgressInfo }
  | { type: 'install:analyzing'; progress: ProgressInfo }
  | { type: 'install:registering'; progress: ProgressInfo }
  | { type: 'install:creating'; progress: ProgressInfo }
  | { type: 'install:completed'; operationId: string; installation: SkillInstallation }
  | { type: 'install:error'; operationId: string; skillSlug: string; error: string }
  // Uninstall
  | { type: 'uninstall:started'; operationId: string; installationId: string }
  | { type: 'uninstall:completed'; operationId: string; installationId: string }
  | { type: 'uninstall:error'; operationId: string; installationId: string; error: string }
  // Analyze
  | { type: 'analyze:started'; operationId: string; versionId: string }
  | { type: 'analyze:parsing'; progress: ProgressInfo }
  | { type: 'analyze:extracting'; progress: ProgressInfo }
  | { type: 'analyze:scanning'; progress: ProgressInfo }
  | {
      type: 'analyze:completed';
      operationId: string;
      versionId: string;
      result: import('@agenshield/ipc').AnalysisResult;
    }
  | { type: 'analyze:error'; operationId: string; versionId: string; error: string }
  // Auto-update
  | { type: 'update:checking'; operationId: string; skillCount: number }
  | { type: 'update:found'; operationId: string; updates: UpdateCheckResult[] }
  | { type: 'update:applying'; operationId: string; skillSlug: string; progress: ProgressInfo }
  | { type: 'update:skill-done'; operationId: string; skillSlug: string; result: UpdateResult }
  | { type: 'update:completed'; operationId: string; results: UpdateResult[] }
  | { type: 'update:error'; operationId: string; error: string }
  // CRUD lifecycle (instant)
  | { type: 'skill:created'; skill: Skill }
  | { type: 'skill:updated'; skill: Skill }
  | { type: 'skill:deleted'; skillId: string }
  | { type: 'version:created'; version: SkillVersion }
  // Deploy
  | { type: 'deploy:started'; operationId: string; installationId: string; adapterId: string; skillSlug: string }
  | { type: 'deploy:copying'; progress: ProgressInfo }
  | { type: 'deploy:completed'; operationId: string; installationId: string; adapterId: string; result: DeployResult }
  | { type: 'deploy:error'; operationId: string; installationId: string; adapterId: string; error: string }
  // Undeploy
  | { type: 'undeploy:started'; operationId: string; installationId: string; adapterId: string }
  | { type: 'undeploy:completed'; operationId: string; installationId: string; adapterId: string }
  | { type: 'undeploy:error'; operationId: string; installationId: string; adapterId: string; error: string }
  // Watcher
  | { type: 'watcher:started'; pollIntervalMs: number }
  | { type: 'watcher:stopped' }
  | { type: 'watcher:poll-started'; operationId: string }
  | { type: 'watcher:poll-completed'; operationId: string; checkedCount: number; violationCount: number }
  | {
      type: 'watcher:integrity-violation';
      operationId: string;
      installationId: string;
      adapterId: string;
      modifiedFiles: string[];
      missingFiles: string[];
      unexpectedFiles: string[];
      action: WatcherAction;
    }
  | { type: 'watcher:quarantined'; operationId: string; installationId: string }
  | { type: 'watcher:reinstalled'; operationId: string; installationId: string }
  | { type: 'watcher:action-error'; operationId: string; installationId: string; action: string; error: string }
  | { type: 'watcher:skill-detected'; operationId: string; slug: string; version: string; quarantinePath: string; reason: string }
  | { type: 'watcher:fs-change'; slug: string }
  | { type: 'watcher:error'; error: string };
