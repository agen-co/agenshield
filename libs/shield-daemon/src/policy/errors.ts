/**
 * Error classes for policy graph evaluation
 */

export class GraphEvaluationError extends Error {
  readonly name = 'GraphEvaluationError';
  readonly code = 'GRAPH_EVALUATION_ERROR';

  constructor(
    message: string,
    public readonly nodeId?: string,
    public readonly edgeId?: string,
  ) {
    super(message);
    Error.captureStackTrace?.(this, this.constructor);
  }
}
