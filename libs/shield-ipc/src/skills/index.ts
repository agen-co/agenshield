// Re-export skill types (excluding SkillSource which conflicts with marketplace.ts)
export type {
  SkillApproval,
  AnalysisStatus,
  InstallationStatus,
  Skill,
  SkillVersion,
  SkillFile,
  SkillInstallation,
} from './skills.types';

export * from './skills.schema';

export type {
  SkillSearchResult,
  RemoteSkillDescriptor,
  AnalysisResult,
  UpdateCheckResult,
  UpdateResult,
  UploadMetadata,
  RemoteSearchResponse,
  VersionCheckResult,
} from './skills-manager.types';

export {
  SOURCE_SLUG_PREFIX,
  prefixSlug,
  stripSlugPrefix,
  sourceHasPrefix,
} from './slug-prefix';

// Adapter types (used by sync service, daemon adapters)
export type {
  TargetPlatform,
  SourceSkillFile,
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
} from './adapter.types';
