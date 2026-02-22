/**
 * SSE hook for shield progress events
 *
 * The old wizard API functions have been removed — the daemon always starts
 * in full mode and the UI determines flow based on DB state.
 */

import { useEffect, useRef } from 'react';
import { setupPanelStore } from '../state/setup-panel';

/**
 * Subscribe to shield progress events via SSE.
 * Updates setupPanelStore.shieldProgress in real time.
 */
export function useShieldSSE(enabled = true) {
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource('/sse/events');
    sourceRef.current = es;

    const handleShieldProgress = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          targetId?: string;
          step?: string;
          progress?: number;
          message?: string;
        };
        if (data.targetId) {
          setupPanelStore.shieldProgress[data.targetId] = {
            status: data.step === 'complete' ? 'completed' : 'in_progress',
            currentStep: data.step ?? '',
            progress: data.progress ?? 0,
            message: data.message ?? '',
          };
        }
      } catch {
        // ignore parse errors
      }
    };

    const handleShieldComplete = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { targetId?: string; profileId?: string };
        if (data.targetId) {
          setupPanelStore.shieldProgress[data.targetId] = {
            status: 'completed',
            currentStep: 'complete',
            progress: 100,
            message: 'Shielding complete',
            profileId: data.profileId,
          };
        }
      } catch {
        // ignore
      }
    };

    const handleShieldError = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { targetId?: string; error?: string };
        if (data.targetId) {
          setupPanelStore.shieldProgress[data.targetId] = {
            status: 'error',
            currentStep: 'error',
            progress: 0,
            message: data.error ?? 'Shield failed',
          };
        }
      } catch {
        // ignore
      }
    };

    es.addEventListener('setup:shield_progress', handleShieldProgress);
    es.addEventListener('setup:shield_complete', handleShieldComplete);
    es.addEventListener('setup:error', handleShieldError);

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [enabled]);
}
