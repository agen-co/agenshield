/**
 * Valtio store for canvas-specific state: pulse animations and selection
 */

import { proxy } from 'valtio';
import type { PulseData } from '../Canvas.types';

export const canvasStore = proxy({
  pulses: {} as Record<string, PulseData>,
  selectedTargetId: null as string | null,
});

export function triggerPulse(targetId: string, severity: PulseData['severity']) {
  canvasStore.pulses[targetId] = { severity, timestamp: Date.now() };

  // Auto-clear after 1.5s
  setTimeout(() => {
    if (canvasStore.pulses[targetId]?.timestamp === canvasStore.pulses[targetId]?.timestamp) {
      delete canvasStore.pulses[targetId];
    }
  }, 1500);
}

export function selectTarget(targetId: string | null) {
  canvasStore.selectedTargetId = targetId;
}
