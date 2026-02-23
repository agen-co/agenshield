/**
 * Sandbox Error Classes
 *
 * Typed error hierarchy for sandbox and installation operations.
 */

export class SandboxError extends Error {
  readonly code: string;

  constructor(message: string, code = 'SANDBOX_ERROR') {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class InstallError extends SandboxError {
  readonly step: string;
  readonly targetId?: string;

  constructor(message: string, step: string, targetId?: string, code = 'INSTALL_ERROR') {
    super(message, code);
    this.name = 'InstallError';
    this.step = step;
    this.targetId = targetId;
  }
}

export class HomebrewInstallError extends InstallError {
  constructor(message: string) {
    super(message, 'homebrew', undefined, 'HOMEBREW_INSTALL_ERROR');
    this.name = 'HomebrewInstallError';
  }
}

export class NvmInstallError extends InstallError {
  constructor(message: string) {
    super(message, 'nvm', undefined, 'NVM_INSTALL_ERROR');
    this.name = 'NvmInstallError';
  }
}

export class TargetAppInstallError extends InstallError {
  readonly appName: string;

  constructor(message: string, appName: string) {
    super(message, 'install_app', undefined, 'TARGET_APP_INSTALL_ERROR');
    this.name = 'TargetAppInstallError';
    this.appName = appName;
  }
}
