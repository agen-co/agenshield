/**
 * SSE events → animated dot spawning.
 *
 * Classifies each new event to determine which firewall piece it flows through,
 * then spawns an animated dot that travels: target → firewall → computer/denied-bucket.
 *
 * Must be called inside <ReactFlow> (uses useReactFlow for node positions).
 */

import { useEffect, useRef } from 'react';
import { subscribe } from 'valtio';
import { useReactFlow } from '@xyflow/react';
import { eventStore } from '../../../state/events';
import { classifyEventToFirewall, isEventDenied } from '../utils/eventClassification';
import { getNodeCenter } from '../utils/dotInterpolation';
import { spawnDot, advanceDot, removeDot, incrementDenied } from '../state/dotAnimations';

const PHASE_1_DURATION = 800;
const PHASE_2_DURATION = 600;

export function useDotAnimations() {
  const lastEventCount = useRef(eventStore.events.length);
  const { getNode } = useReactFlow();

  useEffect(() => {
    const unsub = subscribe(eventStore, () => {
      const currentCount = eventStore.events.length;
      if (currentCount <= lastEventCount.current) {
        lastEventCount.current = currentCount;
        return;
      }

      const newCount = currentCount - lastEventCount.current;
      const newEvents = eventStore.events.slice(0, newCount);
      lastEventCount.current = currentCount;

      for (const event of newEvents) {
        const firewallPiece = classifyEventToFirewall(event);
        if (!firewallPiece) continue;

        // Find the target node for this event
        const d = event.data as Record<string, unknown>;
        const targetId =
          (typeof d.targetId === 'string' && d.targetId) ||
          (typeof d.profileId === 'string' && d.profileId) ||
          (typeof d.target === 'string' && d.target.length < 40 && d.target) ||
          null;

        // Source: specific target node, or core node if no target
        const sourceNodeId = targetId ? `target-${targetId}` : 'core';
        const sourceNode = getNode(sourceNodeId) ?? getNode('core');
        if (!sourceNode) continue;

        const firewallNodeId = `firewall-${firewallPiece}`;
        const firewallNode = getNode(firewallNodeId);
        if (!firewallNode) continue;

        const denied = isEventDenied(event);
        const destinationNodeId = denied ? 'denied-bucket' : 'computer';
        const destinationNode = getNode(destinationNodeId);
        if (!destinationNode) continue;

        const from = getNodeCenter(sourceNode.position, sourceNode.type);
        const firewallCenter = getNodeCenter(firewallNode.position, firewallNode.type);
        const destinationCenter = getNodeCenter(destinationNode.position, destinationNode.type);

        const dotId = spawnDot({
          phase: 'to-firewall',
          denied,
          from,
          to: firewallCenter,
          startTime: Date.now(),
          duration: PHASE_1_DURATION,
          firewallId: firewallPiece,
        });

        // Phase 2: firewall → destination
        setTimeout(() => {
          advanceDot(dotId, destinationCenter, PHASE_2_DURATION);
        }, PHASE_1_DURATION);

        // Cleanup + increment counter
        setTimeout(() => {
          removeDot(dotId);
          if (denied) incrementDenied();
        }, PHASE_1_DURATION + PHASE_2_DURATION);
      }
    });

    return unsub;
  }, [getNode]);
}
