/**
 * SetupPanel types
 */

import type { DetectedTarget, OldInstallation } from '@agenshield/ipc';

export type SetupPanelMode = 'initial-setup' | 'add-profile';

export type SetupStep = 'detection' | 'configure' | 'shielding' | 'complete';

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
