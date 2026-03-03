/**
 * Shield Daemon error classes
 *
 * Typed errors per CLAUDE.md conventions.
 */

export class DaemonError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'DaemonError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Thrown when a target context is required but no profile exists in storage
 * and no AGENSHIELD_AGENT_HOME env var is set.
 */
export class TargetContextNotFoundError extends DaemonError {
  constructor(message?: string) {
    super(
      message ?? 'No target context available — no profile configured and AGENSHIELD_AGENT_HOME not set',
      'TARGET_CONTEXT_NOT_FOUND',
    );
    this.name = 'TargetContextNotFoundError';
  }
}

/**
 * Base error for workspace skill operations.
 */
export class WorkspaceSkillError extends DaemonError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'WorkspaceSkillError';
  }
}

/**
 * Thrown when a workspace skill record is not found by ID.
 */
export class WorkspaceSkillNotFoundError extends WorkspaceSkillError {
  readonly skillId: string;

  constructor(skillId: string) {
    super(`Workspace skill not found: ${skillId}`, 'WORKSPACE_SKILL_NOT_FOUND');
    this.name = 'WorkspaceSkillNotFoundError';
    this.skillId = skillId;
  }
}
