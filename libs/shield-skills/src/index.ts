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
