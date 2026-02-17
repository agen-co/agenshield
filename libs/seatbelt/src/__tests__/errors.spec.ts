import { SeatbeltError, ProfileGenerationError, SandboxConfigError } from '../errors';

describe('SeatbeltError', () => {
  it('sets name, code, and message', () => {
    const err = new SeatbeltError('test message', 'TEST_CODE');
    expect(err.name).toBe('SeatbeltError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
  });

  it('is instanceof Error', () => {
    const err = new SeatbeltError('msg', 'CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SeatbeltError);
  });

  it('has a stack trace', () => {
    const err = new SeatbeltError('msg', 'CODE');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('SeatbeltError');
  });
});

describe('ProfileGenerationError', () => {
  it('has code PROFILE_GENERATION_ERROR', () => {
    const err = new ProfileGenerationError('failed to generate');
    expect(err.code).toBe('PROFILE_GENERATION_ERROR');
  });

  it('sets name to ProfileGenerationError', () => {
    const err = new ProfileGenerationError('msg');
    expect(err.name).toBe('ProfileGenerationError');
  });

  it('is instanceof SeatbeltError and Error', () => {
    const err = new ProfileGenerationError('msg');
    expect(err).toBeInstanceOf(SeatbeltError);
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves the message', () => {
    const err = new ProfileGenerationError('profile disk full');
    expect(err.message).toBe('profile disk full');
  });
});

describe('SandboxConfigError', () => {
  it('has code SANDBOX_CONFIG_ERROR', () => {
    const err = new SandboxConfigError('bad config');
    expect(err.code).toBe('SANDBOX_CONFIG_ERROR');
  });

  it('sets name to SandboxConfigError', () => {
    const err = new SandboxConfigError('msg');
    expect(err.name).toBe('SandboxConfigError');
  });

  it('stores optional command property', () => {
    const err = new SandboxConfigError('bad config', 'curl');
    expect(err.command).toBe('curl');
  });

  it('command is undefined when not provided', () => {
    const err = new SandboxConfigError('bad config');
    expect(err.command).toBeUndefined();
  });

  it('is instanceof SeatbeltError and Error', () => {
    const err = new SandboxConfigError('msg');
    expect(err).toBeInstanceOf(SeatbeltError);
    expect(err).toBeInstanceOf(Error);
  });
});
