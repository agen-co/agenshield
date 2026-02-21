/**
 * Wizard engine for daemon setup mode
 *
 * Copied from libs/cli/src/wizard/ with daemon-specific adjustments:
 * - Uses relative imports for daemon state/vault instead of @agenshield/daemon
 * - Sudo keepalive managed inline (no CLI privilege utilities dependency)
 */

export { createWizardEngine, setEngineLogCallback } from './engine.js';
export type { WizardEngine, StepExecutor } from './engine.js';
export type {
  WizardStep,
  WizardState,
  WizardContext,
  WizardStepId,
  WizardStepStatus,
  WizardOptions,
  WizardStepDefinition,
  SandboxUserInfo,
} from './types.js';
export { createWizardSteps, getStepsByPhase, getAllStepIds, WIZARD_STEPS } from './types.js';

// Privilege execution
export type { PrivilegeExecutor, ExecResult } from './privilege-executor.js';
export { SudoExecutor } from './sudo-executor.js';
export { OsascriptExecutor } from './osascript-executor.js';
