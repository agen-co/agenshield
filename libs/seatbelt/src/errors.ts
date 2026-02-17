/**
 * Typed error classes for @agenshield/seatbelt
 */

export class SeatbeltError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'SeatbeltError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ProfileGenerationError extends SeatbeltError {
  constructor(message: string) {
    super(message, 'PROFILE_GENERATION_ERROR');
    this.name = 'ProfileGenerationError';
  }
}

export class SandboxConfigError extends SeatbeltError {
  readonly command?: string;

  constructor(message: string, command?: string) {
    super(message, 'SANDBOX_CONFIG_ERROR');
    this.name = 'SandboxConfigError';
    this.command = command;
  }
}
