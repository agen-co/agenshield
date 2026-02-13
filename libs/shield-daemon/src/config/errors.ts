/**
 * Configuration error types
 */

export class ConfigTamperError extends Error {
  public readonly code = 'CONFIG_TAMPERED';

  constructor(message = 'Config file has been tampered with. Falling back to deny-all.') {
    super(message);
    this.name = 'ConfigTamperError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}
