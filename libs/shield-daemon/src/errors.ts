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
