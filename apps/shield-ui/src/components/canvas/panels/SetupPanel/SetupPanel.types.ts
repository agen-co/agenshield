/**
 * SetupPanel types
 *
 * Supports two flows:
 * - CLI setup mode: wizard engine SSE-driven steps (all 31 grouped by phase)
 * - Daemon mode: simplified 4-step flow (detection → configure → shield → complete)
 */

import type { DetectedTarget, OldInstallation } from '@agenshield/ipc';

export type SetupPanelMode = 'initial-setup' | 'add-profile';

/** Daemon mode step flow */
export type SetupStep = 'state-overview' | 'detection' | 'configure' | 'shielding' | 'complete';

export interface SetupPanelProps {
  open: boolean;
  onClose: () => void;
  mode: SetupPanelMode;
}

export interface ShieldProgressEntry {
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  currentStep?: string;
  progress: number;
  message?: string;
  profileId?: string;
}

export interface DetectionStepProps {
  targets: DetectedTarget[];
  oldInstallations: OldInstallation[];
  isLoading: boolean;
  onRefresh: () => void;
  onSelectTarget: (targetId: string) => void;
  selectedTargetId: string | null;
}

export interface ConfigureStepProps {
  target: DetectedTarget | null;
  onBack: () => void;
  onShield: () => void;
}

export interface ShieldingStepProps {
  targetId: string;
  progress: ShieldProgressEntry | null;
}

export interface CompleteStepProps {
  mode: SetupPanelMode;
  onComplete: () => void;
  onAddAnother: () => void;
}

export interface StateOverviewStepProps {
  targets: DetectedTarget[];
  isLoading: boolean;
  onSelectTarget: (targetId: string) => void;
  onScanTargets: () => void;
  onAddManual: () => void;
}

/* ---- Wizard engine step phases (CLI setup mode) ---- */

export type WizardPhase = 'detection' | 'infrastructure' | 'target-setup' | 'finalization';

export interface WizardPhaseConfig {
  id: WizardPhase;
  label: string;
  /** Wizard step IDs that belong to this phase */
  stepIds: string[];
}

/** Phase groupings for the wizard engine steps */
export const WIZARD_PHASES: WizardPhaseConfig[] = [
  {
    id: 'detection',
    label: 'Detection',
    stepIds: ['prerequisites', 'detect', 'install-target', 'configure', 'confirm'],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    stepIds: [
      'cleanup-previous', 'create-groups', 'create-agent-user', 'create-broker-user',
      'create-directories', 'setup-socket', 'install-homebrew', 'install-nvm',
      'configure-shell', 'generate-seatbelt', 'install-wrappers', 'install-broker',
      'install-daemon-config', 'install-policies',
    ],
  },
  {
    id: 'target-setup',
    label: 'Target Setup',
    stepIds: [
      'setup-launchdaemon', 'copy-openclaw-config', 'install-openclaw',
      'stop-host-openclaw', 'onboard-openclaw', 'start-openclaw', 'open-dashboard',
    ],
  },
  {
    id: 'finalization',
    label: 'Finalization',
    stepIds: ['verify', 'install-es-extension', 'setup-passcode', 'complete'],
  },
];
