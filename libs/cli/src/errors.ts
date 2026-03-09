/**
 * Typed CLI error classes
 *
 * Follows the project error convention (see libs/interceptor/src/errors.ts).
 * All production code should throw one of these instead of bare `new Error()`.
 */

/**
 * Base error class for all CLI errors.
 */
export class CliError extends Error {
  public readonly code: string;
  public readonly exitCode: number;

  constructor(message: string, code: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      message: this.message,
    };
  }
}

/**
 * Bad arguments or flags.
 */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 'USAGE_ERROR', 2);
    this.name = 'UsageError';
  }
}

/**
 * Daemon is required but not running.
 */
export class DaemonNotRunningError extends CliError {
  constructor(message = 'Daemon is not running. Start it with: agenshield start') {
    super(message, 'DAEMON_NOT_RUNNING');
    this.name = 'DaemonNotRunningError';
  }
}

/**
 * Daemon failed to start.
 */
export class DaemonStartError extends CliError {
  public readonly logFile?: string;

  constructor(message: string, logFile?: string) {
    super(message, 'DAEMON_START_FAILED');
    this.name = 'DaemonStartError';
    this.logFile = logFile;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), logFile: this.logFile };
  }
}

/**
 * Authentication failure.
 */
export class AuthError extends CliError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTH_FAILED');
    this.name = 'AuthError';
  }
}

/**
 * Requires elevated privileges (sudo / root).
 */
export class PrivilegeError extends CliError {
  public readonly command?: string;

  constructor(message = 'This operation requires administrator privileges', command?: string) {
    super(message, 'PRIVILEGE_REQUIRED');
    this.name = 'PrivilegeError';
    this.command = command;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), command: this.command };
  }
}

/**
 * Agent target user not found.
 */
export class TargetNotFoundError extends CliError {
  public readonly target: string;

  constructor(target: string, message?: string) {
    super(message ?? `Target "${target}" not found`, 'TARGET_NOT_FOUND');
    this.name = 'TargetNotFoundError';
    this.target = target;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), target: this.target };
  }
}

/**
 * Network / connection issue.
 */
export class ConnectionError extends CliError {
  constructor(message = 'Failed to connect to daemon') {
    super(message, 'CONNECTION_FAILED');
    this.name = 'ConnectionError';
  }
}

/**
 * Service management operation failed (install, uninstall, status).
 */
export class ServiceError extends CliError {
  public readonly operation: string;

  constructor(message: string, operation: string) {
    super(message, 'SERVICE_ERROR');
    this.name = 'ServiceError';
    this.operation = operation;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), operation: this.operation };
  }
}

/**
 * Setup has not been completed yet.
 */
export class SetupRequiredError extends CliError {
  constructor() {
    super(
      'AgenShield has not been set up yet. Run `agenshield setup` to get started.',
      'SETUP_REQUIRED',
    );
    this.name = 'SetupRequiredError';
  }
}
