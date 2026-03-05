import {
  StorageLockedError,
  StorageNotInitializedError,
  ValidationError,
  PasscodeError,
  DatabasePermissionError,
  DatabaseTamperError,
  DatabaseCorruptedError,
} from '../errors';

describe('StorageLockedError', () => {
  it('has default message', () => {
    const err = new StorageLockedError();
    expect(err.message).toBe('Vault is locked. Provide passcode to unlock.');
    expect(err.name).toBe('StorageLockedError');
    expect(err).toBeInstanceOf(Error);
  });

  it('accepts custom message', () => {
    const err = new StorageLockedError('Custom locked message');
    expect(err.message).toBe('Custom locked message');
  });
});

describe('StorageNotInitializedError', () => {
  it('has default message', () => {
    const err = new StorageNotInitializedError();
    expect(err.message).toBe('Storage has not been initialized. Call initStorage() first.');
    expect(err.name).toBe('StorageNotInitializedError');
  });

  it('accepts custom message', () => {
    const err = new StorageNotInitializedError('Custom init message');
    expect(err.message).toBe('Custom init message');
  });
});

describe('ValidationError', () => {
  it('has message and empty issues by default', () => {
    const err = new ValidationError('Validation failed');
    expect(err.message).toBe('Validation failed');
    expect(err.name).toBe('ValidationError');
    expect(err.issues).toEqual([]);
  });

  it('stores issues array', () => {
    const issues = [{ path: ['name'], message: 'required' }];
    const err = new ValidationError('fail', issues);
    expect(err.issues).toEqual(issues);
  });
});

describe('PasscodeError', () => {
  it('has message and name', () => {
    const err = new PasscodeError('Wrong passcode');
    expect(err.message).toBe('Wrong passcode');
    expect(err.name).toBe('PasscodeError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('DatabasePermissionError', () => {
  it('has default message with path', () => {
    const err = new DatabasePermissionError('/data/test.db');
    expect(err.message).toContain('/data/test.db');
    expect(err.message).toContain('owned by root');
    expect(err.name).toBe('DatabasePermissionError');
    expect(err.code).toBe('DATABASE_PERMISSION');
    expect(err.dbPath).toBe('/data/test.db');
  });

  it('accepts custom message', () => {
    const err = new DatabasePermissionError('/data/test.db', 'Custom perm message');
    expect(err.message).toBe('Custom perm message');
    expect(err.dbPath).toBe('/data/test.db');
  });

  it('has stack trace', () => {
    const err = new DatabasePermissionError('/data/test.db');
    expect(err.stack).toBeDefined();
  });
});

describe('DatabaseTamperError', () => {
  it('has default message', () => {
    const err = new DatabaseTamperError();
    expect(err.message).toContain('unexpected application_id');
    expect(err.name).toBe('DatabaseTamperError');
    expect(err.code).toBe('DATABASE_TAMPERED');
  });

  it('accepts custom message', () => {
    const err = new DatabaseTamperError('Custom tamper message');
    expect(err.message).toBe('Custom tamper message');
  });

  it('has stack trace', () => {
    const err = new DatabaseTamperError();
    expect(err.stack).toBeDefined();
  });
});

describe('DatabaseCorruptedError', () => {
  it('includes table names in message', () => {
    const err = new DatabaseCorruptedError('/data/test.db', ['meta', 'profiles']);
    expect(err.message).toContain('meta');
    expect(err.message).toContain('profiles');
    expect(err.message).toContain('2 required table(s)');
    expect(err.message).toContain('/data/test.db');
    expect(err.name).toBe('DatabaseCorruptedError');
    expect(err.code).toBe('DATABASE_CORRUPTED');
    expect(err.dbPath).toBe('/data/test.db');
    expect(err.missingTables).toEqual(['meta', 'profiles']);
  });

  it('has stack trace', () => {
    const err = new DatabaseCorruptedError('/data/test.db', ['meta']);
    expect(err.stack).toBeDefined();
  });
});
