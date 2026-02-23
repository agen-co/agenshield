/**
 * Valtio store for the canvas SetupPanel state.
 *
 * Tracks detection results, shield progress, and panel UI state.
 * Updated by SSE events and API responses.
 */

import { proxy } from 'valtio';
import type { DetectedTarget, OldInstallation, ShieldStepState } from '@agenshield/ipc';

export interface ShieldLogEntry {
  message: string;
  stepId?: string;
  timestamp: number;
}

export interface ShieldStepEntry {
  id: string;
  name: string;
  description: string;
  status: ShieldStepState['status'];
  durationMs?: number;
  error?: string;
  logs: ShieldLogEntry[];
}

export interface ShieldProgressEntry {
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  currentStep?: string;
  progress: number;
  message?: string;
  profileId?: string;
  logs: ShieldLogEntry[];
  /** Granular step states (populated by setup:shield_steps events) */
  steps: ShieldStepEntry[];
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
  /** IDs of cards dismissed (hidden) from the canvas */
  dismissedCardIds: string[];
  /** Pre-selected target ID for direct shield-wizard entry */
  preSelectedTargetId: string | null;
}

const DISMISSED_KEY = 'agenshield:dismissed-cards';

function loadDismissedIds(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistDismissedIds(ids: string[]): void {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
}

export const setupPanelStore = proxy<SetupPanelState>({
  detectedTargets: [],
  oldInstallations: [],
  isDetecting: false,
  shieldProgress: {},
  panelOpen: false,
  panelMode: null,
  dismissedCardIds: loadDismissedIds(),
  preSelectedTargetId: null,
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
 * Update shield progress for a target (called from SSE handler).
 * Preserves existing logs array.
 */
export function updateShieldProgress(
  targetId: string,
  step: string,
  progress: number,
  message?: string,
): void {
  const existing = setupPanelStore.shieldProgress[targetId];
  setupPanelStore.shieldProgress[targetId] = {
    status: progress >= 100 ? 'completed' : 'in_progress',
    currentStep: step,
    progress,
    message,
    logs: existing?.logs ?? [],
    steps: existing?.steps ?? [],
  };
}

/**
 * Mark a target as fully shielded (called from SSE handler).
 * Preserves existing logs array.
 */
export function markShieldComplete(targetId: string, profileId: string): void {
  const existing = setupPanelStore.shieldProgress[targetId];
  setupPanelStore.shieldProgress[targetId] = {
    status: 'completed',
    progress: 100,
    message: 'Shielding complete',
    profileId,
    logs: existing?.logs ?? [],
    steps: existing?.steps ?? [],
  };
}

const MAX_SHIELD_LOGS = 200;

/**
 * Append a log entry to a target's shield progress (called from SSE handler).
 * Capped at MAX_SHIELD_LOGS entries to prevent unbounded memory growth.
 */
export function appendShieldLog(targetId: string, message: string, stepId?: string): void {
  const existing = setupPanelStore.shieldProgress[targetId];
  if (existing) {
    existing.logs.push({ message, stepId, timestamp: Date.now() });
    if (existing.logs.length > MAX_SHIELD_LOGS) {
      existing.logs.splice(0, existing.logs.length - MAX_SHIELD_LOGS);
    }
  } else {
    setupPanelStore.shieldProgress[targetId] = {
      status: 'in_progress',
      progress: 0,
      logs: [{ message, stepId, timestamp: Date.now() }],
      steps: [],
    };
  }
}

/**
 * Open the setup panel
 */
/**
 * Update granular shield steps (called from SSE handler for setup:shield_steps).
 */
export function updateShieldSteps(
  targetId: string,
  steps: ShieldStepState[],
  overallProgress: number,
): void {
  const existing = setupPanelStore.shieldProgress[targetId];
  const stepEntries: ShieldStepEntry[] = steps.map((s) => {
    // Preserve existing per-step logs
    const prev = existing?.steps.find((e) => e.id === s.id);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      status: s.status,
      durationMs: s.durationMs,
      error: s.error,
      logs: prev?.logs ?? [],
    };
  });

  setupPanelStore.shieldProgress[targetId] = {
    status: overallProgress >= 100 ? 'completed' : 'in_progress',
    currentStep: steps.find((s) => s.status === 'running')?.name,
    progress: overallProgress,
    message: steps.find((s) => s.status === 'running')?.description,
    profileId: existing?.profileId,
    logs: existing?.logs ?? [],
    steps: stepEntries,
  };
}

/**
 * Append a log entry to a specific step (called from SSE handler for setup:step_log).
 */
export function appendStepLog(
  targetId: string,
  stepId: string,
  message: string,
): void {
  const existing = setupPanelStore.shieldProgress[targetId];
  if (!existing) return;
  const step = existing.steps.find((s) => s.id === stepId);
  if (step) {
    step.logs.push({ message, stepId, timestamp: Date.now() });
    if (step.logs.length > 50) {
      step.logs.splice(0, step.logs.length - 50);
    }
  }
}

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
 * Dismiss (hide) a card from the canvas.
 */
export function dismissCard(id: string): void {
  if (!setupPanelStore.dismissedCardIds.includes(id)) {
    setupPanelStore.dismissedCardIds.push(id);
    persistDismissedIds([...setupPanelStore.dismissedCardIds]);
  }
}

/**
 * Restore a previously dismissed card.
 */
export function restoreCard(id: string): void {
  const idx = setupPanelStore.dismissedCardIds.indexOf(id);
  if (idx !== -1) {
    setupPanelStore.dismissedCardIds.splice(idx, 1);
    persistDismissedIds([...setupPanelStore.dismissedCardIds]);
  }
}

/**
 * Open setup panel pre-selecting a specific target (skip detection step).
 */
export function openSetupPanelForTarget(targetId: string): void {
  setupPanelStore.preSelectedTargetId = targetId;
  setupPanelStore.panelOpen = true;
  setupPanelStore.panelMode = 'add-profile';
}

/**
 * Add a manual target to the detection list.
 * Allows multiple instances of the same type with unique IDs.
 */
/**
 * Whether any target is currently being shielded (in_progress or pending).
 */
export function isShieldingActive(): boolean {
  return Object.values(setupPanelStore.shieldProgress).some(
    (p) => p.status === 'in_progress' || p.status === 'pending',
  );
}

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
