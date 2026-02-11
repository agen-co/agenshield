/**
 * @agentshield/skills — Standalone skill lifecycle manager
 *
 * @packageDocumentation
 */

// Manager
export { SkillManager } from './manager';
export type { SkillManagerOptions } from './manager';

// Remote client
export type { RemoteSkillClient } from './remote/types';
export { DefaultRemoteClient } from './remote/client';
export type { DefaultRemoteClientOptions } from './remote/client';

// Analyze
export { AnalyzeService } from './analyze';
export { BasicAnalyzeAdapter, RemoteAnalyzeAdapter } from './analyze';
export type { AnalyzeAdapter, RemoteAnalyzeAdapterOptions } from './analyze';

// Catalog
export { CatalogService } from './catalog';
export { LocalSearchAdapter, RemoteSearchAdapter } from './catalog';
export type { SearchAdapter } from './catalog';

// Install
export { InstallService } from './install';
export type { InstallParams } from './install';

// Upload
export { UploadService } from './upload';
export type { UploadFromZipParams, UploadResult } from './upload';

// Update
export { UpdateService } from './update';

// Deploy
export { DeployService, OpenClawDeployAdapter } from './deploy';
export type {
  DeployAdapter,
  DeployContext,
  DeployResult,
  IntegrityCheckResult,
  OpenClawDeployAdapterOptions,
} from './deploy';

// Watcher
export { SkillWatcherService } from './watcher';
export type {
  WatcherPolicy,
  WatcherAction,
  WatcherOptions,
  ResolvedWatcherPolicy,
  SkillScanCallbacks,
} from './watcher';

// Errors
export {
  SkillsError,
  SkillNotFoundError,
  VersionNotFoundError,
  RemoteSkillNotFoundError,
  RemoteApiError,
  AnalysisError,
} from './errors';

// Events
export type { SkillEvent, ProgressInfo } from './events';
