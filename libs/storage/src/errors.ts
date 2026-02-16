/**
 * Storage error types
 */

export class StorageLockedError extends Error {
  constructor(message = 'Vault is locked. Provide passcode to unlock.') {
    super(message);
    this.name = 'StorageLockedError';
  }
}

export class StorageNotInitializedError extends Error {
  constructor(message = 'Storage has not been initialized. Call initStorage() first.') {
    super(message);
    this.name = 'StorageNotInitializedError';
  }
}

export class ValidationError extends Error {
  public readonly issues: unknown[];

  constructor(message: string, issues: unknown[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class PasscodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasscodeError';
  }
}

export class DatabaseTamperError extends Error {
  public readonly code = 'DATABASE_TAMPERED';

  constructor(message = 'Database file has an unexpected application_id — it may have been replaced or tampered with.') {
    super(message);
    this.name = 'DatabaseTamperError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class DatabaseCorruptedError extends Error {
  public readonly code = 'DATABASE_CORRUPTED';
  public readonly dbPath: string;
  public readonly missingTables: string[];

  constructor(dbPath: string, missingTables: string[]) {
    super(
      `Database is corrupted: migration records indicate schema was applied, but ${missingTables.length} required table(s) are missing (${missingTables.join(', ')}). ` +
      `Delete "${dbPath}" to regenerate.`,
    );
    this.name = 'DatabaseCorruptedError';
    this.dbPath = dbPath;
    this.missingTables = missingTables;
    Error.captureStackTrace?.(this, this.constructor);
  }
}
