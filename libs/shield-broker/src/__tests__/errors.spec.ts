import { BrokerError, WorkspaceAccessDeniedError } from '../errors.js';

describe('BrokerError', () => {
  it('should extend Error with name and code', () => {
    const err = new BrokerError('test message', 'TEST_CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BrokerError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
  });

  it('should have a stack trace', () => {
    const err = new BrokerError('test', 'CODE');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('BrokerError');
  });
});

describe('WorkspaceAccessDeniedError', () => {
  it('should extend BrokerError with path property', () => {
    const err = new WorkspaceAccessDeniedError('/forbidden/path');
    expect(err).toBeInstanceOf(BrokerError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WorkspaceAccessDeniedError');
    expect(err.code).toBe('WORKSPACE_ACCESS_DENIED');
    expect(err.path).toBe('/forbidden/path');
    expect(err.message).toContain('/forbidden/path');
  });
});
