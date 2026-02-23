/**
 * SSE events -> pulse triggers on target nodes
 *
 * Listens to the valtio event store and triggers visual pulses
 * on relevant target nodes when new events arrive.
 *
 * Throttled via requestAnimationFrame to prevent DOM saturation
 * during high event throughput (e.g. preset installation).
 */

import { useEffect, useRef } from 'react';
import { subscribe } from 'valtio';
import { eventStore } from '../../../state/events';
import { triggerPulse } from '../state/canvas';
import { BLOCKED_EVENT_TYPES } from '../../../utils/eventDisplay';
import { fireShotForTarget, fireShotForComponent } from '../state/shot-registry';
import { classifyEventToFirewall } from '../utils/eventClassification';

/** Max events to process per animation frame */
const MAX_EVENTS_PER_FRAME = 5;

export function useCanvasAnimations() {
  const lastEventCount = useRef(eventStore.events.length);
  const pendingRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const unsub = subscribe(eventStore, () => {
      const currentCount = eventStore.events.length;
      if (currentCount <= lastEventCount.current) {
        lastEventCount.current = currentCount;
        return;
      }

      pendingRef.current += currentCount - lastEventCount.current;
      lastEventCount.current = currentCount;

      // Coalesce into a single requestAnimationFrame
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const batch = Math.min(pendingRef.current, MAX_EVENTS_PER_FRAME);
          const newEvents = eventStore.events.slice(0, batch);
          pendingRef.current = 0;

          for (const event of newEvents) {
            const targetId = extractTargetId(event.data as Record<string, unknown>);
            if (!targetId) continue;

            const isBlocked = BLOCKED_EVENT_TYPES.has(event.type) ||
              (event.type === 'interceptor:event' &&
                (String((event.data as Record<string, unknown>).type ?? '') === 'denied'));

            const isWarning = event.type.includes('warning') || event.type.includes('quarantined');

            const severity = isBlocked ? 'error' : isWarning ? 'warning' : 'success';
            triggerPulse(targetId, severity);

            // Fire electric shots on wires connected to this target
            fireShotForTarget(targetId);

            // Fire shots on aux component wires based on event type
            const firewallPiece = classifyEventToFirewall(event);
            if (firewallPiece === 'network') fireShotForComponent('monitoring');
            if (firewallPiece === 'system') fireShotForComponent('secrets');
            if (firewallPiece === 'filesystem') fireShotForComponent('policy-graph');

            if (event.type.startsWith('skill:')) fireShotForComponent('skills');
            if (event.type.startsWith('security:') || event.type === 'exec:denied') fireShotForComponent('secrets');
          }
        });
      }
    });

    return () => {
      unsub();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);
}

function extractTargetId(data: Record<string, unknown>): string | null {
  if (typeof data.targetId === 'string') return data.targetId;
  if (typeof data.profileId === 'string') return data.profileId;
  if (typeof data.target === 'string' && data.target.length < 40) return data.target;
  return null;
}
