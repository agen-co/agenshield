/**
 * ShieldStepTracker — Granular step progress for shield operations.
 *
 * Holds the full step array and emits `setup:shield_steps` on every
 * state transition. Also emits backward-compat `setup:shield_progress`
 * so older UI builds still get progress updates.
 */

import type { ShieldStepDefinition, ShieldStepState, ShieldStepStatus } from '@agenshield/ipc';
import { emitEvent } from '../events/emitter';

export class ShieldStepTracker {
  private readonly targetId: string;
  private profileId?: string;
  private readonly steps: ShieldStepState[];
  /** Maps step id → index for O(1) lookup */
  private readonly indexMap: Map<string, number>;

  constructor(targetId: string, definitions: ShieldStepDefinition[], profileId?: string) {
    this.targetId = targetId;
    this.profileId = profileId;
    this.indexMap = new Map();
    this.steps = definitions.map((def, i) => {
      this.indexMap.set(def.id, i);
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        status: 'pending' as ShieldStepStatus,
      };
    });

    // Emit initial state
    this.broadcast();
  }

  /** Dynamically add a step (for pipeline-injected steps). */
  addStep(definition: ShieldStepDefinition, afterId?: string): void {
    if (this.indexMap.has(definition.id)) return; // Already registered

    const newState: ShieldStepState = {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      status: 'pending' as ShieldStepStatus,
    };

    if (afterId) {
      const afterIdx = this.indexMap.get(afterId);
      if (afterIdx !== undefined) {
        this.steps.splice(afterIdx + 1, 0, newState);
        // Rebuild index map
        this.indexMap.clear();
        this.steps.forEach((s, i) => this.indexMap.set(s.id, i));
        this.broadcast();
        return;
      }
    }

    // Append at end if no position specified or afterId not found
    this.indexMap.set(definition.id, this.steps.length);
    this.steps.push(newState);
    this.broadcast();
  }

  /** Mark a step as running. */
  startStep(id: string): void {
    const step = this.get(id);
    if (!step) return;
    step.status = 'running';
    step.startedAt = new Date().toISOString();
    step.finishedAt = undefined;
    step.durationMs = undefined;
    step.error = undefined;
    this.broadcast();
  }

  /** Mark a step as completed. */
  completeStep(id: string): void {
    const step = this.get(id);
    if (!step) return;
    step.status = 'completed';
    step.finishedAt = new Date().toISOString();
    if (step.startedAt) {
      step.durationMs = new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
    }
    this.broadcast();
  }

  /** Mark a step as failed. */
  failStep(id: string, error: string): void {
    const step = this.get(id);
    if (!step) return;
    step.status = 'failed';
    step.error = error;
    step.finishedAt = new Date().toISOString();
    if (step.startedAt) {
      step.durationMs = new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
    }
    this.broadcast();
  }

  /** Mark a step as skipped. */
  skipStep(id: string): void {
    const step = this.get(id);
    if (!step) return;
    step.status = 'skipped';
    this.broadcast();
  }

  /** Set the profileId after profile creation (mid-shield). */
  setProfileId(id: string): void {
    this.profileId = id;
  }

  /** Emit a per-step log message. */
  logStep(stepId: string, message: string, level?: 'info' | 'warn' | 'error'): void {
    emitEvent('setup:step_log', { targetId: this.targetId, stepId, message, level }, this.profileId);
  }

  /** Get the computed overall progress (0-100). */
  get overallProgress(): number {
    const done = this.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    return Math.round((done / this.steps.length) * 100);
  }

  /** Get the current step array (readonly snapshot). */
  getSteps(): readonly ShieldStepState[] {
    return this.steps;
  }

  /** Get the current profileId (may be undefined before profile creation). */
  getProfileId(): string | undefined {
    return this.profileId;
  }

  // ── Internal ────────────────────────────────────────────────

  private get(id: string): ShieldStepState | undefined {
    const idx = this.indexMap.get(id);
    return idx !== undefined ? this.steps[idx] : undefined;
  }

  private broadcast(): void {
    const progress = this.overallProgress;

    // New granular event
    emitEvent('setup:shield_steps', {
      targetId: this.targetId,
      steps: [...this.steps],
      overallProgress: progress,
    }, this.profileId);

    // Backward-compat: map to legacy shield_progress event
    const running = this.steps.find(s => s.status === 'running');
    emitEvent('setup:shield_progress', {
      targetId: this.targetId,
      step: running?.id ?? (progress >= 100 ? 'complete' : 'initializing'),
      progress,
      message: running?.name ?? (progress >= 100 ? 'Shielding complete' : 'Preparing...'),
    }, this.profileId);
  }
}
