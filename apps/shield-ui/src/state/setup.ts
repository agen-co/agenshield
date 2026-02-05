/**
 * Valtio store for setup wizard state
 *
 * Separate from the main app state. Keeps wizard state, graph state,
 * and executable state in sync. Updated by SSE events.
 */

import { proxy } from 'valtio';

// --- Types ---

export type SetupPhase = 'detection' | 'configuration' | 'execution' | 'passcode' | 'complete';
export type GraphPhase = 'vulnerable' | 'building' | 'securing' | 'secured';

export type WizardStepId =
  | 'prerequisites'
  | 'detect'
  | 'configure'
  | 'confirm'
  | 'backup'
  | 'create-groups'
  | 'create-agent-user'
  | 'create-broker-user'
  | 'create-directories'
  | 'setup-socket'
  | 'generate-seatbelt'
  | 'install-wrappers'
  | 'install-broker'
  | 'install-daemon-config'
  | 'install-policies'
  | 'setup-launchdaemon'
  | 'migrate'
  | 'verify'
  | 'setup-passcode'
  | 'complete';

export interface WizardStep {
  id: WizardStepId;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
  error?: string;
}

export interface WizardState {
  currentStep: number;
  steps: WizardStep[];
  isComplete: boolean;
  hasError: boolean;
}

export interface ExecutableInfo {
  name: string;
  path: string;
  dir: string;
  isProxied: boolean;
  isWrapped: boolean;
  isAllowed: boolean;
  category: 'system' | 'package-manager' | 'network' | 'shell' | 'other';
}

// --- Store ---

export interface SetupStore {
  // Wizard state (from engine via SSE)
  phase: SetupPhase;
  wizardState: WizardState | null;
  context: Record<string, unknown> | null;

  // UI state
  currentUIStep: number; // 0-6 for the 7 wizard UI steps
  mode: 'quick' | 'advanced' | null;
  baseName: string;

  // Graph state
  graphPhase: GraphPhase;
  completedEngineSteps: WizardStepId[];

  // Executables
  executables: ExecutableInfo[];
  executablesLoaded: boolean;
}

export const setupStore = proxy<SetupStore>({
  phase: 'detection',
  wizardState: null,
  context: null,

  currentUIStep: 0,
  mode: null,
  baseName: '',

  graphPhase: 'vulnerable',
  completedEngineSteps: [],

  executables: [],
  executablesLoaded: false,
});

// --- Helpers ---

/**
 * Map completed engine steps to graph phase
 */
export function deriveGraphPhase(completedSteps: WizardStepId[]): GraphPhase {
  if (completedSteps.includes('verify') || completedSteps.includes('complete')) {
    return 'secured';
  }
  if (completedSteps.includes('generate-seatbelt') || completedSteps.includes('install-wrappers')) {
    return 'securing';
  }
  if (completedSteps.includes('create-groups') || completedSteps.includes('create-agent-user')) {
    return 'building';
  }
  return 'vulnerable';
}

/**
 * Map UI step index to label
 */
export const UI_STEPS = [
  { label: 'Detection', key: 'detection' },
  { label: 'Mode', key: 'mode' },
  { label: 'Configuration', key: 'config' },
  { label: 'Confirm', key: 'confirm' },
  { label: 'Installation', key: 'execute' },
  { label: 'Passcode', key: 'passcode' },
  { label: 'Complete', key: 'complete' },
] as const;
