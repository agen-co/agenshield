/**
 * SetupPanel types
 *
 * Supports the daemon-mode 4-step flow:
 * State Overview → Detection → Configure → Shield → Complete
 */

import type { DetectedTarget, OldInstallation } from '@agenshield/ipc';
import type { ShieldStepEntry } from '../../../../state/setup-panel';

export type SetupPanelMode = 'initial-setup' | 'add-profile';

export type SetupStep = 'passcode' | 'state-overview' | 'scan-results' | 'detection' | 'configure' | 'shielding' | 'complete';

export interface SetupPanelProps {
  open: boolean;
  onClose: () => void;
  mode: SetupPanelMode;
}

export interface ShieldLogEntry {
  message: string;
  stepId?: string;
  timestamp: number;
}

export interface ShieldProgressEntry {
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  currentStep?: string;
  progress: number;
  message?: string;
  profileId?: string;
  logs: ShieldLogEntry[];
  steps: ShieldStepEntry[];
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
  onShield: (baseName?: string, version?: string) => void;
  error?: string | null;
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
