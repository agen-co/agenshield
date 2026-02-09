/**
 * Valtio store for update wizard state
 *
 * Keeps update state in sync with SSE events from the update server.
 */

import { proxy } from 'valtio';

export type UpdatePhase = 'release-notes' | 'authenticate' | 'confirm' | 'execution' | 'complete' | 'error';

export interface UpdateStepState {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
  error?: string;
  isMigration?: boolean;
  migrationVersion?: string;
}

export interface UpdateStateData {
  fromVersion: string;
  toVersion: string;
  steps: UpdateStepState[];
  isComplete: boolean;
  hasError: boolean;
  releaseNotes: string;
  authRequired: boolean;
  authenticated: boolean;
}

export interface UpdateStore {
  /** Current UI phase */
  phase: UpdatePhase;
  /** Server-side update state (from SSE) */
  updateState: UpdateStateData | null;
  /** Completed step IDs */
  completedSteps: string[];
  /** Streaming log line per step */
  stepLogs: Record<string, string>;
  /** Auth error message */
  authError: string | null;
}

export const updateStore = proxy<UpdateStore>({
  phase: 'release-notes',
  updateState: null,
  completedSteps: [],
  stepLogs: {},
  authError: null,
});
