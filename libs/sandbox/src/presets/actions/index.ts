/**
 * Install Step Pipeline
 *
 * Re-exports the pipeline runner, types, and step definitions.
 */

// Core types
export type {
  StepUser,
  CheckResult,
  StepResult,
  PipelineState,
  InstallStep,
  PipelineOptions,
  PipelineResult,
} from './types.js';

// Runner
export { runPipeline } from './runner.js';

// Rollback registry
export {
  registerRollback,
  getRollbackHandler,
  getRegisteredRollbackSteps,
  type RollbackContext,
  type RollbackHandler,
} from './rollback-registry.js';

// Rollback handlers (side-effect: registers all handlers on import)
export { ROLLBACK_HANDLERS_REGISTERED } from './rollbacks/index.js';

// Shared steps
export * from './shared/index.js';

// Preset pipelines
export { getOpenclawPipeline } from './openclaw/index.js';
export { getClaudeCodePipeline } from './claude-code/index.js';
