/**
 * Skill Source Adapter Types — re-exported from @agenshield/ipc
 */

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
} from '@agenshield/ipc';

/** Backward-compatible alias — SourceSkillFile was previously named SkillFile in adapter context */
export type { SourceSkillFile as SkillFile } from '@agenshield/ipc';
