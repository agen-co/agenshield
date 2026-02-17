/**
 * Error classes — unit tests
 */

import {
  PolicyError,
  PolicyNotFoundError,
  PolicySetNotFoundError,
  GraphCycleError,
  GraphEvaluationError,
  SecretResolutionError,
  CompilationError,
} from '../errors';

describe('PolicyError (base)', () => {
  it('is an instance of Error', () => {
    const err = new PolicyError('test', 'TEST_CODE');
    expect(err).toBeInstanceOf(Error);
  });

  it('sets name to PolicyError', () => {
    const err = new PolicyError('test', 'TEST_CODE');
    expect(err.name).toBe('PolicyError');
  });

  it('stores the code', () => {
    const err = new PolicyError('test', 'TEST_CODE');
    expect(err.code).toBe('TEST_CODE');
  });

  it('captures stack trace', () => {
    const err = new PolicyError('test', 'TEST_CODE');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('PolicyError');
  });
});

describe('PolicyNotFoundError', () => {
  it('is an instance of PolicyError', () => {
    const err = new PolicyNotFoundError('p-123');
    expect(err).toBeInstanceOf(PolicyError);
  });

  it('stores the policyId', () => {
    const err = new PolicyNotFoundError('p-123');
    expect(err.policyId).toBe('p-123');
  });

  it('has POLICY_NOT_FOUND code', () => {
    const err = new PolicyNotFoundError('p-123');
    expect(err.code).toBe('POLICY_NOT_FOUND');
  });

  it('includes policyId in message', () => {
    const err = new PolicyNotFoundError('p-123');
    expect(err.message).toContain('p-123');
  });
});

describe('PolicySetNotFoundError', () => {
  it('is an instance of PolicyError', () => {
    const err = new PolicySetNotFoundError('ps-456');
    expect(err).toBeInstanceOf(PolicyError);
  });

  it('stores the policySetId', () => {
    const err = new PolicySetNotFoundError('ps-456');
    expect(err.policySetId).toBe('ps-456');
  });

  it('has POLICY_SET_NOT_FOUND code', () => {
    const err = new PolicySetNotFoundError('ps-456');
    expect(err.code).toBe('POLICY_SET_NOT_FOUND');
  });
});

describe('GraphCycleError', () => {
  it('is an instance of PolicyError', () => {
    const err = new GraphCycleError('n1', 'n2');
    expect(err).toBeInstanceOf(PolicyError);
  });

  it('stores sourceId and targetId', () => {
    const err = new GraphCycleError('n1', 'n2');
    expect(err.sourceId).toBe('n1');
    expect(err.targetId).toBe('n2');
  });

  it('has GRAPH_CYCLE code', () => {
    const err = new GraphCycleError('n1', 'n2');
    expect(err.code).toBe('GRAPH_CYCLE');
  });

  it('includes source and target in message', () => {
    const err = new GraphCycleError('src-node', 'tgt-node');
    expect(err.message).toContain('src-node');
    expect(err.message).toContain('tgt-node');
  });
});

describe('GraphEvaluationError', () => {
  it('has GRAPH_EVALUATION_ERROR code', () => {
    const err = new GraphEvaluationError('eval failed');
    expect(err.code).toBe('GRAPH_EVALUATION_ERROR');
  });

  it('stores optional nodeId', () => {
    const err = new GraphEvaluationError('eval failed', 'n1');
    expect(err.nodeId).toBe('n1');
    expect(err.edgeId).toBeUndefined();
  });

  it('stores optional edgeId', () => {
    const err = new GraphEvaluationError('eval failed', undefined, 'e1');
    expect(err.edgeId).toBe('e1');
    expect(err.nodeId).toBeUndefined();
  });

  it('stores both nodeId and edgeId', () => {
    const err = new GraphEvaluationError('eval failed', 'n1', 'e1');
    expect(err.nodeId).toBe('n1');
    expect(err.edgeId).toBe('e1');
  });
});

describe('SecretResolutionError', () => {
  it('stores the secretName', () => {
    const err = new SecretResolutionError('MY_TOKEN');
    expect(err.secretName).toBe('MY_TOKEN');
  });

  it('has SECRET_RESOLUTION_ERROR code', () => {
    const err = new SecretResolutionError('MY_TOKEN');
    expect(err.code).toBe('SECRET_RESOLUTION_ERROR');
  });

  it('includes reason in message when provided', () => {
    const err = new SecretResolutionError('MY_TOKEN', 'vault locked');
    expect(err.message).toContain('MY_TOKEN');
    expect(err.message).toContain('vault locked');
  });

  it('omits reason from message when not provided', () => {
    const err = new SecretResolutionError('MY_TOKEN');
    expect(err.message).toContain('MY_TOKEN');
    expect(err.message).not.toContain(':');
  });
});

describe('CompilationError', () => {
  it('has COMPILATION_ERROR code', () => {
    const err = new CompilationError('failed to compile');
    expect(err.code).toBe('COMPILATION_ERROR');
  });

  it('forwards message', () => {
    const err = new CompilationError('invalid policy target');
    expect(err.message).toBe('invalid policy target');
  });

  it('is an instance of PolicyError', () => {
    const err = new CompilationError('test');
    expect(err).toBeInstanceOf(PolicyError);
  });
});
