import {
  AgenShieldError,
  PolicyDeniedError,
  BrokerUnavailableError,
  TimeoutError,
  InvalidOperationError,
  ResourceLimitExceededError,
} from '../errors';

describe('AgenShieldError', () => {
  it('sets name, code, message, and optional fields', () => {
    const err = new AgenShieldError('test msg', 'TEST_CODE', {
      operation: 'exec',
      target: '/bin/ls',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AgenShieldError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test msg');
    expect(err.operation).toBe('exec');
    expect(err.target).toBe('/bin/ls');
    expect(err.stack).toBeDefined();
  });

  it('works without optional fields', () => {
    const err = new AgenShieldError('bare', 'BARE');
    expect(err.operation).toBeUndefined();
    expect(err.target).toBeUndefined();
  });
});

describe('PolicyDeniedError', () => {
  it('sets code to POLICY_DENIED and preserves policyId', () => {
    const err = new PolicyDeniedError('denied', {
      operation: 'http_request',
      target: 'https://evil.com',
      policyId: 'policy-123',
    });
    expect(err).toBeInstanceOf(AgenShieldError);
    expect(err.name).toBe('PolicyDeniedError');
    expect(err.code).toBe('POLICY_DENIED');
    expect(err.policyId).toBe('policy-123');
    expect(err.operation).toBe('http_request');
    expect(err.target).toBe('https://evil.com');
  });

  it('works without options', () => {
    const err = new PolicyDeniedError('no opts');
    expect(err.policyId).toBeUndefined();
  });
});

describe('BrokerUnavailableError', () => {
  it('uses default message', () => {
    const err = new BrokerUnavailableError();
    expect(err.name).toBe('BrokerUnavailableError');
    expect(err.code).toBe('BROKER_UNAVAILABLE');
    expect(err.message).toBe('AgenShield broker is unavailable');
  });

  it('accepts custom message', () => {
    const err = new BrokerUnavailableError('socket closed');
    expect(err.message).toBe('socket closed');
  });
});

describe('TimeoutError', () => {
  it('uses default message', () => {
    const err = new TimeoutError();
    expect(err.name).toBe('TimeoutError');
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toBe('Request timed out');
  });

  it('accepts custom message', () => {
    const err = new TimeoutError('5s elapsed');
    expect(err.message).toBe('5s elapsed');
  });
});

describe('InvalidOperationError', () => {
  it('sets code and operation', () => {
    const err = new InvalidOperationError('bad op', 'websocket');
    expect(err.name).toBe('InvalidOperationError');
    expect(err.code).toBe('INVALID_OPERATION');
    expect(err.operation).toBe('websocket');
  });

  it('works without operation', () => {
    const err = new InvalidOperationError('bad');
    expect(err.operation).toBeUndefined();
  });
});

describe('ResourceLimitExceededError', () => {
  it('sets all contextual fields', () => {
    const err = new ResourceLimitExceededError('memory exceeded', {
      pid: 1234,
      metric: 'memory',
      currentValue: 512,
      threshold: 256,
    });
    expect(err).toBeInstanceOf(AgenShieldError);
    expect(err.name).toBe('ResourceLimitExceededError');
    expect(err.code).toBe('RESOURCE_LIMIT_EXCEEDED');
    expect(err.operation).toBe('exec');
    expect(err.pid).toBe(1234);
    expect(err.metric).toBe('memory');
    expect(err.currentValue).toBe(512);
    expect(err.threshold).toBe(256);
  });

  it('supports cpu metric', () => {
    const err = new ResourceLimitExceededError('cpu high', {
      pid: 42,
      metric: 'cpu',
      currentValue: 99,
      threshold: 80,
    });
    expect(err.metric).toBe('cpu');
  });

  it('supports timeout metric', () => {
    const err = new ResourceLimitExceededError('timed out', {
      pid: 7,
      metric: 'timeout',
      currentValue: 60000,
      threshold: 30000,
    });
    expect(err.metric).toBe('timeout');
  });
});
