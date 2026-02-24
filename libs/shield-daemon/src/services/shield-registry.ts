/**
 * In-memory registry of active shield operations.
 *
 * Allows the frontend to query current progress after reconnect/refresh
 * so that in-progress operations survive page reloads.
 */

import type { ShieldStepState } from '@agenshield/ipc';
import type { ShieldStepTracker } from './shield-step-tracker';

interface ActiveShieldOperation {
  targetId: string;
  targetName: string;
  startedAt: string;
  tracker: ShieldStepTracker;
}

const activeOperations = new Map<string, ActiveShieldOperation>();

export function registerShieldOperation(
  targetId: string,
  targetName: string,
  tracker: ShieldStepTracker,
): void {
  activeOperations.set(targetId, {
    targetId,
    targetName,
    startedAt: new Date().toISOString(),
    tracker,
  });
}

export function unregisterShieldOperation(targetId: string): void {
  activeOperations.delete(targetId);
}

export interface ActiveOperationSnapshot {
  targetId: string;
  targetName: string;
  startedAt: string;
  status: 'in_progress';
  progress: number;
  currentStep?: string;
  steps: ShieldStepState[];
}

export function getActiveShieldOperations(): ActiveOperationSnapshot[] {
  const result: ActiveOperationSnapshot[] = [];
  for (const op of activeOperations.values()) {
    const steps = op.tracker.getSteps();
    const running = steps.find((s) => s.status === 'running');
    result.push({
      targetId: op.targetId,
      targetName: op.targetName,
      startedAt: op.startedAt,
      status: 'in_progress',
      progress: op.tracker.overallProgress,
      currentStep: running?.name,
      steps: [...steps],
    });
  }
  return result;
}
