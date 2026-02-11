/**
 * @agenshield/skills
 *
 * OpenClaw-compatible skills with Soul integration.
 */

export { SkillLoader } from './loader.js';
export { SkillValidator, validateSkill } from './validator.js';
export { SkillExecutor } from './executor.js';
export { SkillRegistry } from './registry.js';
export { SoulInjector } from './soul/injector.js';
export { DefaultSoulContent, getSoulContent } from './soul/templates.js';

export type {
  Skill,
  SkillManifest,
  SkillRequirements,
  AgenShieldConfig,
  SoulConfig,
  ExecuteOptions,
  ExecuteResult,
  ValidationResult,
} from './types.js';

// ─── Adapter types ────────────────────────────────────────────
export type {
  SkillSourceAdapter,
  SkillDefinition,
  SkillFile,
  DiscoveredTool,
  RequiredBinary,
  BinaryInstallMethod,
  AdapterInstructions,
  ToolQuery,
  AdapterSyncResult,
  InstalledSkillVersion,
  SkillVersionStore,
  SkillInstaller,
  InstallOptions,
  UninstallOptions,
  SkillsManagerEvent,
  TargetPlatform,
} from './adapters/types.js';

// ─── Sources & Manager ───────────────────────────────────────
export { StaticSkillSource } from './adapters/static-source.js';
export { SkillsManager, computeSkillDefinitionSha } from './manager.js';
export type { SkillsManagerOptions } from './manager.js';
