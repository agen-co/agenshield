/**
 * Typed error classes for @agenshield/policies
 */

export class PolicyError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class PolicyNotFoundError extends PolicyError {
  readonly policyId: string;

  constructor(policyId: string) {
    super(`Policy not found: ${policyId}`, 'POLICY_NOT_FOUND');
    this.name = 'PolicyNotFoundError';
    this.policyId = policyId;
  }
}

export class PolicySetNotFoundError extends PolicyError {
  readonly policySetId: string;

  constructor(policySetId: string) {
    super(`Policy set not found: ${policySetId}`, 'POLICY_SET_NOT_FOUND');
    this.name = 'PolicySetNotFoundError';
    this.policySetId = policySetId;
  }
}

export class GraphCycleError extends PolicyError {
  readonly sourceId: string;
  readonly targetId: string;

  constructor(sourceId: string, targetId: string) {
    super(`Adding edge from ${sourceId} to ${targetId} would create a cycle`, 'GRAPH_CYCLE');
    this.name = 'GraphCycleError';
    this.sourceId = sourceId;
    this.targetId = targetId;
  }
}

export class GraphEvaluationError extends PolicyError {
  readonly nodeId?: string;
  readonly edgeId?: string;

  constructor(message: string, nodeId?: string, edgeId?: string) {
    super(message, 'GRAPH_EVALUATION_ERROR');
    this.name = 'GraphEvaluationError';
    this.nodeId = nodeId;
    this.edgeId = edgeId;
  }
}

export class SecretResolutionError extends PolicyError {
  readonly secretName: string;

  constructor(secretName: string, reason?: string) {
    super(
      `Failed to resolve secret "${secretName}"${reason ? `: ${reason}` : ''}`,
      'SECRET_RESOLUTION_ERROR',
    );
    this.name = 'SecretResolutionError';
    this.secretName = secretName;
  }
}

export class CompilationError extends PolicyError {
  constructor(message: string) {
    super(message, 'COMPILATION_ERROR');
    this.name = 'CompilationError';
  }
}
