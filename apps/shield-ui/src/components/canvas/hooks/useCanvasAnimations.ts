/**
 * SSE events -> pulse triggers on target nodes
 *
 * Listens to the valtio event store and triggers visual pulses
 * on relevant target nodes when new events arrive.
 */

import { useEffect, useRef } from 'react';
import { subscribe } from 'valtio';
import { eventStore } from '../../../state/events';
import { triggerPulse } from '../state/canvas';
import { BLOCKED_EVENT_TYPES } from '../../../utils/eventDisplay';

export function useCanvasAnimations() {
  const lastEventCount = useRef(eventStore.events.length);

  useEffect(() => {
    const unsub = subscribe(eventStore, () => {
      const currentCount = eventStore.events.length;
      if (currentCount <= lastEventCount.current) {
        lastEventCount.current = currentCount;
        return;
      }

      // Process new events (they're prepended, so check from start)
      const newCount = currentCount - lastEventCount.current;
      const newEvents = eventStore.events.slice(0, newCount);
      lastEventCount.current = currentCount;

      for (const event of newEvents) {
        const targetId = extractTargetId(event.data as Record<string, unknown>);
        if (!targetId) continue;

        const isBlocked = BLOCKED_EVENT_TYPES.has(event.type) ||
          (event.type === 'interceptor:event' &&
            (String((event.data as Record<string, unknown>).type ?? '') === 'denied'));

        const isWarning = event.type.includes('warning') || event.type.includes('quarantined');

        const severity = isBlocked ? 'error' : isWarning ? 'warning' : 'success';
        triggerPulse(targetId, severity);
      }
    });

    return unsub;
  }, []);
}

function extractTargetId(data: Record<string, unknown>): string | null {
  if (typeof data.targetId === 'string') return data.targetId;
  if (typeof data.profileId === 'string') return data.profileId;
  if (typeof data.target === 'string' && data.target.length < 40) return data.target;
  return null;
}
