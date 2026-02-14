/**
 * SSE events → animated dot spawning.
 *
 * Classifies each new event to determine which firewall piece it flows through,
 * then spawns an animated dot that travels:
 *   Allowed: target → policy-graph → firewall-{piece} → computer (3 phases)
 *   Denied:  target → policy-graph → denied-bucket (2 phases)
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

const PHASE_1_DURATION = 600;  // target → policy graph
const PHASE_2_DURATION = 500;  // policy graph → firewall piece
const PHASE_3_DURATION = 500;  // firewall piece → computer

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

        const policyGraphNode = getNode('policy-graph');
        if (!policyGraphNode) continue;

        const denied = isEventDenied(event);

        const from = getNodeCenter(sourceNode.position, sourceNode.type);
        const policyCenter = getNodeCenter(policyGraphNode.position, policyGraphNode.type);

        // Phase 1: target → policy graph
        const dotId = spawnDot({
          phase: 'to-policy',
          denied,
          from,
          to: policyCenter,
          startTime: Date.now(),
          duration: PHASE_1_DURATION,
          firewallId: firewallPiece,
        });

        if (denied) {
          // Denied: 2 phases — policy graph → denied bucket
          const deniedNode = getNode('denied-bucket');
          if (!deniedNode) continue;
          const deniedCenter = getNodeCenter(deniedNode.position, deniedNode.type);

          setTimeout(() => {
            advanceDot(dotId, 'to-destination', deniedCenter, PHASE_2_DURATION);
          }, PHASE_1_DURATION);

          setTimeout(() => {
            removeDot(dotId);
            incrementDenied();
          }, PHASE_1_DURATION + PHASE_2_DURATION);
        } else {
          // Allowed: 3 phases — policy graph → firewall → computer
          const firewallNodeId = `firewall-${firewallPiece}`;
          const firewallNode = getNode(firewallNodeId);
          if (!firewallNode) continue;
          const firewallCenter = getNodeCenter(firewallNode.position, firewallNode.type);

          const computerNode = getNode('computer');
          if (!computerNode) continue;
          const computerCenter = getNodeCenter(computerNode.position, computerNode.type);

          // Phase 2: policy graph → firewall piece
          setTimeout(() => {
            advanceDot(dotId, 'to-firewall', firewallCenter, PHASE_2_DURATION);
          }, PHASE_1_DURATION);

          // Phase 3: firewall piece → computer
          setTimeout(() => {
            advanceDot(dotId, 'to-destination', computerCenter, PHASE_3_DURATION);
          }, PHASE_1_DURATION + PHASE_2_DURATION);

          // Cleanup
          setTimeout(() => {
            removeDot(dotId);
          }, PHASE_1_DURATION + PHASE_2_DURATION + PHASE_3_DURATION);
        }
      }
    });

    return unsub;
  }, [getNode]);
}
