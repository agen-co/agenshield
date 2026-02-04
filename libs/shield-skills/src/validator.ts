/**
 * Skill Validator
 *
 * Validates skill manifests and content.
 */

import type { Skill, SkillManifest, ValidationResult } from './types.js';

export class SkillValidator {
  /**
   * Validate a skill
   */
  validate(skill: Skill): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!skill.name) {
      errors.push('Missing required field: name');
    } else if (!/^[a-z0-9-]+$/.test(skill.name)) {
      errors.push('Invalid name: must be lowercase alphanumeric with hyphens');
    }

    if (!skill.description) {
      warnings.push('Missing description');
    }

    // Command dispatch
    if (skill.commandDispatch && !['bash', 'node', 'python'].includes(skill.commandDispatch)) {
      errors.push(`Invalid commandDispatch: ${skill.commandDispatch}`);
    }

    // Command arg mode
    if (skill.commandArgMode && !['single', 'multi'].includes(skill.commandArgMode)) {
      errors.push(`Invalid commandArgMode: ${skill.commandArgMode}`);
    }

    // Requirements validation
    if (skill.requires) {
      if (skill.requires.bins && !Array.isArray(skill.requires.bins)) {
        errors.push('requires.bins must be an array');
      }

      if (skill.requires.anyBins && !Array.isArray(skill.requires.anyBins)) {
        errors.push('requires.anyBins must be an array');
      }

      if (skill.requires.env && !Array.isArray(skill.requires.env)) {
        errors.push('requires.env must be an array');
      }
    }

    // AgenShield config validation
    if (skill.agenshield) {
      if (skill.agenshield.auditLevel &&
          !['debug', 'info', 'warn', 'error'].includes(skill.agenshield.auditLevel)) {
        errors.push(`Invalid agenshield.auditLevel: ${skill.agenshield.auditLevel}`);
      }

      if (skill.agenshield.securityLevel &&
          !['low', 'medium', 'high'].includes(skill.agenshield.securityLevel)) {
        errors.push(`Invalid agenshield.securityLevel: ${skill.agenshield.securityLevel}`);
      }

      if (skill.agenshield.allowedCommands &&
          !Array.isArray(skill.agenshield.allowedCommands)) {
        errors.push('agenshield.allowedCommands must be an array');
      }
    }

    // Content validation
    if (!skill.content || skill.content.length < 10) {
      warnings.push('Skill content is very short');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a manifest before loading
   */
  validateManifest(manifest: SkillManifest): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!manifest.name) {
      errors.push('Missing required field: name');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

/**
 * Validate a skill (standalone function)
 */
export function validateSkill(skill: Skill): ValidationResult {
  const validator = new SkillValidator();
  return validator.validate(skill);
}
