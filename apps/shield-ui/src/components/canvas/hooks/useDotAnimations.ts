/**
 * SSE events → animated dot spawning.
 *
 * Classifies each new event to determine which firewall piece it flows through,
 * then spawns an animated dot that travels along orthogonal PCB trace paths
 * (inverted layout — targets at bottom):
 *   Allowed: target (bottom) → core (AgenShield) → firewall → computer (top) — 3 phases upward
 *   Denied:  target → core → denied-bucket — 2 phases
 *
 * Dots follow orthogonal (Manhattan-style) paths matching the PCB trace routing.
 *
 * Demo mode: spawns periodic pulses when no real events are flowing.
 *
 * Must be called inside <ReactFlow> (uses useReactFlow for node positions).
 */

import { useEffect, useRef } from 'react';
import { subscribe } from 'valtio';
import { Position, useReactFlow } from '@xyflow/react';
import { eventStore } from '../../../state/events';
import { systemStore } from '../../../state/system-store';
import { pcb } from '../styles/pcb-tokens';
import { classifyEventToFirewall, isEventDenied } from '../utils/eventClassification';
import { getNodeCenter } from '../utils/dotInterpolation';
import { computeOrthogonalRoute } from '../utils/orthogonalRouter';
import { spawnDot, advanceDot, removeDot, incrementDenied } from '../state/dotAnimations';

const PHASE_1_DURATION = 400;  // target → core
const PHASE_2_DURATION = 350;  // core → firewall piece
const PHASE_3_DURATION = 350;  // firewall piece → computer

const FIREWALL_IDS = ['network', 'system', 'filesystem'];

export function useDotAnimations() {
  const lastEventCount = useRef(eventStore.events.length);
  const { getNode, getNodes } = useReactFlow();
  const demoTimerRef = useRef<number>(0);

  // Compute orthogonal route between two node centers
  function getRoute(
    sourceCenter: { x: number; y: number },
    targetCenter: { x: number; y: number },
    sourcePos: Position,
    targetPos: Position,
  ) {
    return computeOrthogonalRoute(sourceCenter, targetCenter, sourcePos, targetPos);
  }

  // Spawn a single pulse through the pipeline (bottom → top for allowed)
  function spawnPulse(sourceNodeId: string, firewallPiece: string, denied: boolean) {
    const sourceNode = getNode(sourceNodeId) ?? getNode('core');
    if (!sourceNode) return;

    const coreNode = getNode('core');
    if (!coreNode) return;

    const from = getNodeCenter(sourceNode.position, sourceNode.type);
    const coreCenter = getNodeCenter(coreNode.position, coreNode.type);

    // Phase 1: source (target at bottom) → core
    const route1 = getRoute(from, coreCenter, Position.Top, Position.Bottom);

    const dotId = spawnDot({
      phase: 'to-policy',
      denied,
      waypoints: route1.waypoints,
      pathLength: route1.totalLength,
      startTime: Date.now(),
      duration: PHASE_1_DURATION,
      firewallId: firewallPiece,
    });

    if (denied) {
      // Denied: 2 phases — core → denied bucket
      const deniedNode = getNode('denied-bucket');
      if (!deniedNode) return;
      const deniedCenter = getNodeCenter(deniedNode.position, deniedNode.type);
      const route2 = getRoute(coreCenter, deniedCenter, Position.Left, Position.Right);

      setTimeout(() => {
        advanceDot(dotId, 'to-destination', route2.waypoints, route2.totalLength, PHASE_2_DURATION);
      }, PHASE_1_DURATION);

      setTimeout(() => {
        removeDot(dotId);
        incrementDenied();
      }, PHASE_1_DURATION + PHASE_2_DURATION);
    } else {
      // Allowed: 3 phases — core → firewall → computer (upward)
      const firewallNodeId = `firewall-${firewallPiece}`;
      const firewallNode = getNode(firewallNodeId);
      if (!firewallNode) return;
      const firewallCenter = getNodeCenter(firewallNode.position, firewallNode.type);

      const computerNode = getNode('computer');
      if (!computerNode) return;
      const computerCenter = getNodeCenter(computerNode.position, computerNode.type);

      const route2 = getRoute(coreCenter, firewallCenter, Position.Top, Position.Bottom);
      const route3 = getRoute(firewallCenter, computerCenter, Position.Top, Position.Bottom);

      setTimeout(() => {
        advanceDot(dotId, 'to-firewall', route2.waypoints, route2.totalLength, PHASE_2_DURATION);
      }, PHASE_1_DURATION);

      setTimeout(() => {
        advanceDot(dotId, 'to-destination', route3.waypoints, route3.totalLength, PHASE_3_DURATION);
      }, PHASE_1_DURATION + PHASE_2_DURATION);

      setTimeout(() => {
        removeDot(dotId);
      }, PHASE_1_DURATION + PHASE_2_DURATION + PHASE_3_DURATION);
    }
  }

  // Real event processing
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

        const d = event.data as Record<string, unknown>;
        const targetId =
          (typeof d.targetId === 'string' && d.targetId) ||
          (typeof d.profileId === 'string' && d.profileId) ||
          (typeof d.target === 'string' && d.target.length < 40 && d.target) ||
          null;

        const sourceNodeId = targetId ? `target-${targetId}` : 'core';
        const denied = isEventDenied(event);

        spawnPulse(sourceNodeId, firewallPiece, denied);
      }
    });

    return unsub;
  }, [getNode]);

  // Monitoring pulse: green dot from computer → core on each event loop snapshot
  useEffect(() => {
    let lastPulseCount = systemStore.eventLoopPulseCount;
    const unsub = subscribe(systemStore, () => {
      const current = systemStore.eventLoopPulseCount;
      if (current <= lastPulseCount) return;
      lastPulseCount = current;

      const computerNode = getNode('computer');
      const coreNode = getNode('core');
      if (!computerNode || !coreNode) return;

      const computerCenter = getNodeCenter(computerNode.position, computerNode.type);
      const coreCenter = getNodeCenter(coreNode.position, coreNode.type);
      const route = getRoute(computerCenter, coreCenter, Position.Bottom, Position.Top);
      const duration = 600;

      const dotId = spawnDot({
        phase: 'to-policy',
        denied: false,
        waypoints: route.waypoints,
        pathLength: route.totalLength,
        startTime: Date.now(),
        duration,
        firewallId: 'monitoring',
        color: pcb.component.ledGreen,
      });

      setTimeout(() => removeDot(dotId), duration);
    });
    return unsub;
  }, [getNode]);

  // Demo mode: spawn periodic pulses when no real events flowing
  useEffect(() => {
    function scheduleDemo() {
      demoTimerRef.current = window.setTimeout(() => {
        // Only demo when few/no events
        if (eventStore.events.length < 3) {
          // Find available target nodes (now at bottom)
          const allNodes = getNodes();
          const targetNodes = allNodes.filter(n => n.type === 'canvas-target');
          const sourceId = targetNodes.length > 0
            ? targetNodes[Math.floor(Math.random() * targetNodes.length)].id
            : 'core';

          const firewallPiece = FIREWALL_IDS[Math.floor(Math.random() * FIREWALL_IDS.length)];
          const denied = Math.random() < 0.2; // 20% denied

          spawnPulse(sourceId, firewallPiece, denied);
        }
        scheduleDemo();
      }, 2000 + Math.random() * 1500);
    }

    scheduleDemo();
    return () => clearTimeout(demoTimerRef.current);
  }, [getNode, getNodes]);
}
