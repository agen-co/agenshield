/**
 * Sync module — Source adapters, sync service, and utilities
 */

// Types (re-exported from @agenshield/ipc)
export type {
  TargetPlatform,
  SourceSkillFile,
  SkillFile,
  DiscoveredTool,
  ToolQuery,
  BinaryInstallMethod,
  RequiredBinary,
  SkillDefinition,
  AdapterInstructions,
  AdapterSyncResult,
  InstalledSkillVersion,
  SkillVersionStore,
  InstallOptions,
  UninstallOptions,
  SkillInstaller,
  SkillsManagerEvent,
  SkillSourceAdapter,
} from './types';

// Service
export { SyncService } from './sync.service';
export type { SyncServiceOptions } from './sync.service';

// Sources
export { StaticSkillSource } from './static-source';

// Utilities
export { computeSkillDefinitionSha } from './utils';
