/**
 * @agenshield/skills
 *
 * OpenClaw-compatible skills with Soul integration.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __skills_dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the built-in skills directory bundled with this package */
export const BUILTIN_SKILLS_DIR = path.resolve(__skills_dirname, '..', 'skills');

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
