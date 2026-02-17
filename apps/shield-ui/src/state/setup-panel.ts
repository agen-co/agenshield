/**
 * Valtio store for the canvas SetupPanel state.
 *
 * Tracks detection results, shield progress, and panel UI state.
 * Updated by SSE events and API responses.
 */

import { proxy } from 'valtio';
import type { DetectedTarget, OldInstallation } from '@agenshield/ipc';

export interface ShieldProgressEntry {
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  currentStep?: string;
  progress: number;
  message?: string;
  profileId?: string;
}

export interface SetupPanelState {
  /** Targets detected on the system */
  detectedTargets: DetectedTarget[];
  /** Old AgenShield installations */
  oldInstallations: OldInstallation[];
  /** Whether a detection scan is in progress */
  isDetecting: boolean;
  /** Per-target shielding progress (keyed by targetId) */
  shieldProgress: Record<string, ShieldProgressEntry>;
  /** Whether the setup panel is open */
  panelOpen: boolean;
  /** Panel mode */
  panelMode: 'initial-setup' | 'add-profile' | null;
}

export const setupPanelStore = proxy<SetupPanelState>({
  detectedTargets: [],
  oldInstallations: [],
  isDetecting: false,
  shieldProgress: {},
  panelOpen: false,
  panelMode: null,
});

/**
 * Reset the setup panel state (e.g. when reopening)
 */
export function resetSetupPanel(): void {
  setupPanelStore.detectedTargets = [];
  setupPanelStore.oldInstallations = [];
  setupPanelStore.isDetecting = false;
  setupPanelStore.shieldProgress = {};
}

/**
 * Update shield progress for a target (called from SSE handler)
 */
export function updateShieldProgress(
  targetId: string,
  step: string,
  progress: number,
  message?: string,
): void {
  setupPanelStore.shieldProgress[targetId] = {
    status: progress >= 100 ? 'completed' : 'in_progress',
    currentStep: step,
    progress,
    message,
  };
}

/**
 * Mark a target as fully shielded (called from SSE handler)
 */
export function markShieldComplete(targetId: string, profileId: string): void {
  setupPanelStore.shieldProgress[targetId] = {
    status: 'completed',
    progress: 100,
    message: 'Shielding complete',
    profileId,
  };
}

/**
 * Open the setup panel
 */
export function openSetupPanel(mode: 'initial-setup' | 'add-profile'): void {
  setupPanelStore.panelOpen = true;
  setupPanelStore.panelMode = mode;
}

/**
 * Close the setup panel
 */
export function closeSetupPanel(): void {
  setupPanelStore.panelOpen = false;
}

/**
 * Known target presets for manual addition
 */
export const KNOWN_PRESETS = [
  { id: 'claude-code', name: 'Claude Code', icon: 'Terminal' },
  { id: 'openclaw', name: 'OpenClaw', icon: 'Globe' },
  { id: 'cursor', name: 'Cursor', icon: 'Monitor' },
] as const;

/**
 * Add a manual target to the detection list.
 * Allows multiple instances of the same type with unique IDs.
 */
export function addManualTarget(presetId: string, customName?: string): void {
  const preset = KNOWN_PRESETS.find((p) => p.id === presetId);

  // Count existing instances of this type
  const existingCount = setupPanelStore.detectedTargets.filter(
    (t) => t.type === presetId,
  ).length;

  // Generate unique instance ID
  const instanceId = existingCount === 0 ? presetId : `${presetId}-${existingCount}`;
  const displayName = customName ?? preset?.name ?? presetId;
  const instanceName = existingCount > 0
    ? `${displayName} #${existingCount + 1}`
    : displayName;

  setupPanelStore.detectedTargets.push({
    id: instanceId,
    name: instanceName,
    type: presetId,
    method: 'manual',
    shielded: false,
  });
}
