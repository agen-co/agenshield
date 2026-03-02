/**
 * Keychain error classes
 */

/**
 * Base error for Keychain operations.
 */
export class KeychainError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'KeychainError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Keychain is not available on this platform or the helper binary is missing.
 */
export class KeychainNotAvailableError extends KeychainError {
  constructor(reason: string) {
    super(`Keychain not available: ${reason}`, 'KEYCHAIN_NOT_AVAILABLE');
    this.name = 'KeychainNotAvailableError';
  }
}

/**
 * Access to a Keychain item was denied (user cancelled prompt or no entitlement).
 */
export class KeychainAccessDeniedError extends KeychainError {
  public readonly account: string;

  constructor(account: string, detail?: string) {
    super(
      `Keychain access denied for "${account}"${detail ? `: ${detail}` : ''}`,
      'KEYCHAIN_ACCESS_DENIED',
    );
    this.name = 'KeychainAccessDeniedError';
    this.account = account;
  }
}

/**
 * Keychain item not found.
 */
export class KeychainItemNotFoundError extends KeychainError {
  public readonly account: string;

  constructor(account: string) {
    super(`Keychain item not found: "${account}"`, 'KEYCHAIN_ITEM_NOT_FOUND');
    this.name = 'KeychainItemNotFoundError';
    this.account = account;
  }
}
