/**
 * Computes node and edge positions for the setup canvas topology.
 *
 * Three-phase layout with pin allocation:
 *   Phase A: Geometry — compute node positions, component centerXs, etc.
 *   Phase B: Intent + Allocate — build ConnectionIntents, call allocatePins()
 *   Phase C: Build nodes + edges using allocated handle positions
 *
 * Layout (4-piece shield logo):
 *
 *        [CPU] [NET] [CMD] [FS] [MEM]
 *                     │
 *  SEC ──┐       ┌────┴────┐       ┌── MON
 *  POL ──┘───────│  SHIELD │───────└── LOG
 *                └────┬────┘
 *                     │
 *              [Broker][Broker]
 *
 * Core components above the shield (5), connecting to top handles.
 * Auxiliary components on left/right sides of shield.
 * Broker-wrapped cards below the shield.
 */

import { useMemo, useEffect } from 'react';
import { Position, type Node, type Edge } from '@xyflow/react';
import type { SetupCanvasData, SystemComponentType, ConnectionIntent, HandleSpec } from '../Canvas.types';
import { VARIANTS } from '../nodes/SystemComponentNode/system.constants';
import { setAllExposed, setExtendedComponentsActive } from '../../../state/system-store';
import { allocatePins } from '../utils/pinAllocator';

interface ViewportSize {
  width: number;
  height: number;
}

/* ---- System component definitions — w/h from VARIANTS registry ---- */
const SYSTEM_COMPONENTS: { id: SystemComponentType; label: string; sublabel: string; w: number; h: number }[] = [
  { id: 'cpu', label: 'CPU', sublabel: 'Process', w: VARIANTS.cpu.w, h: VARIANTS.cpu.h },
  { id: 'network', label: 'NETWORK', sublabel: 'eth0', w: VARIANTS.network.w, h: VARIANTS.network.h },
  { id: 'command', label: 'CMD EXEC', sublabel: 'shell', w: VARIANTS.command.w, h: VARIANTS.command.h },
  { id: 'filesystem', label: 'DISK', sublabel: 'nvme0', w: VARIANTS.filesystem.w, h: VARIANTS.filesystem.h },
  { id: 'memory', label: 'MEMORY', sublabel: 'DDR5', w: VARIANTS.memory.w, h: VARIANTS.memory.h },
  { id: 'monitoring', label: 'MONITOR', sublabel: 'sys', w: VARIANTS.monitoring.w, h: VARIANTS.monitoring.h },
  { id: 'logs', label: 'LOGS', sublabel: 'syslog', w: VARIANTS.logs.w, h: VARIANTS.logs.h },
  { id: 'secrets', label: 'SECRETS', sublabel: 'vault', w: VARIANTS.secrets.w, h: VARIANTS.secrets.h },
  { id: 'policy-graph', label: 'POLICY', sublabel: 'rules', w: VARIANTS['policy-graph'].w, h: VARIANTS['policy-graph'].h },
];

const findComp = (id: SystemComponentType) => SYSTEM_COMPONENTS.find((c) => c.id === id)!;
const filterComps = (ids: SystemComponentType[]) => SYSTEM_COMPONENTS.filter((c) => ids.includes(c.id));

/** 5 core components positioned ABOVE the shield */
const CORE_COMPONENTS = filterComps(['cpu', 'network', 'command', 'filesystem', 'memory']);
/** Secrets, PolicyGraph on left side of shield */
const LEFT_AUX_COMPONENTS = filterComps(['secrets', 'policy-graph']);
/** Monitor, Logs on right side of shield */
const RIGHT_AUX_COMPONENTS = filterComps(['monitoring', 'logs']);

/* ---- Shield dimension constants ---- */
const SHIELD_W = 350;
const SHIELD_H = 350;

/* ---- Component positioning ---- */
const COMP_GAP = 60;           // Gap between component and shield edge
const COMP_V_GAP = 20;        // Vertical gap between stacked components
const CORE_H_GAP = 24;        // Horizontal gap between core components in top row
const BROKER_GAP = 80;        // Gap from shield bottom to broker row
const BROKER_H_GAP = 40;      // Horizontal gap between brokers
const BROKER_W = 232;
const BROKER_H = 152;

/* ---- Wire routing ---- */
const WIRE_COUNT = 3;
const WIRE_SPACING = 4;
const DANGER_WIRE_COUNT = 3;
const DANGER_WIRE_SPACING = 4;

/* ---- Handle ranges on the shield (in node-local pixels, viewBox 0..200 scaled to 0..350) ---- */
const SCALE = SHIELD_W / 200;

// Top of shield: SVG y≈15, x spans ~65-135 → pixels 114-236
const TOP_HANDLE_RANGE = { min: 65 * SCALE, max: 135 * SCALE };
// Bottom of shield: SVG y≈190, x spans ~75-125 → pixels 131-219
const BOTTOM_HANDLE_RANGE = { min: 75 * SCALE, max: 125 * SCALE };
// Left edge: SVG x≈21, y spans ~40-155 → pixels 70-271
const LEFT_HANDLE_RANGE = { min: 50 * SCALE, max: 145 * SCALE };
// Right edge: SVG x≈179, y spans ~40-155 → pixels 70-271
const RIGHT_HANDLE_RANGE = { min: 50 * SCALE, max: 145 * SCALE };

/** Distribute N values evenly across a range */
function distributeHandles(count: number, range: { min: number; max: number }): number[] {
  if (count === 0) return [];
  if (count === 1) return [(range.min + range.max) / 2];
  return Array.from({ length: count }, (_, i) =>
    range.min + (range.max - range.min) * i / (count - 1),
  );
}

export function useSetupCanvasLayout(data: SetupCanvasData, viewport: ViewportSize) {
  const { width: vw, height: vh } = viewport;

  // Sync exposed state to unified valtio store
  const hasAnyUnshielded = data.anyUnshielded;
  useEffect(() => {
    setAllExposed(hasAnyUnshielded);
  }, [hasAnyUnshielded]);

  // Show auxiliary components only when AgenShield is active (at least one shielded card)
  const hasAnyShielded = data.anyShielded;
  useEffect(() => {
    setExtendedComponentsActive(hasAnyShielded);
  }, [hasAnyShielded]);

  const isExtended = data.anyShielded;

  const topologyKey = useMemo(
    () =>
      JSON.stringify({
        cardIds: data.cards.map((c) => c.id),
        cardStatuses: data.cards.map((c) => `${c.id}:${c.status}`),
        hasDetection: data.hasDetection,
        anyShielded: data.anyShielded,
        anyUnshielded: data.anyUnshielded,
      }),
    [data.cards, data.hasDetection, data.anyShielded, data.anyUnshielded],
  );

  /* ==================================================================
   * Phase B: Pin Allocation
   * ================================================================== */
  const pinAllocation = useMemo(() => {
    if (vw === 0 || vh === 0) return null;

    const topo = JSON.parse(topologyKey) as {
      cardIds: string[];
      cardStatuses: string[];
      hasDetection: boolean;
      anyShielded: boolean;
      anyUnshielded: boolean;
    };

    if (!topo.hasDetection && !topo.anyShielded) return null;

    const contentCenterX = vw / 2 + 180;
    const shieldX = contentCenterX - SHIELD_W / 2;
    const shieldTopY = vh * 0.15;

    const intents: ConnectionIntent[] = [];

    // --- Core components ↔ shield top ---
    if (topo.anyShielded) {
      CORE_COMPONENTS.forEach((comp, i) => {
        intents.push({
          edgeId: `e-comp-shield-${comp.id}-down`,
          sourceNodeId: `comp-${comp.id}`,
          sourceSide: 'bottom',
          sourceHandleType: 'source',
          targetNodeId: 'agenshield',
          targetSide: 'top',
          targetHandleType: 'target',
          sourceOrderHint: contentCenterX,
          targetOrderHint: contentCenterX,
          edgeType: 'canvas-danger',
          edgeData: { variant: 'shield', fanout: true, balanced: true },
          targetFixedHandle: `core-in-${i}`,
        });

        intents.push({
          edgeId: `e-comp-shield-${comp.id}-up`,
          sourceNodeId: 'agenshield',
          sourceSide: 'top',
          sourceHandleType: 'source',
          targetNodeId: `comp-${comp.id}`,
          targetSide: 'bottom',
          targetHandleType: 'target',
          sourceOrderHint: contentCenterX,
          targetOrderHint: contentCenterX,
          edgeType: 'canvas-danger',
          edgeData: { variant: 'shield', fanout: true, balanced: true },
          sourceFixedHandle: `core-out-${i}`,
        });
      });

      // --- Left aux ↔ shield left ---
      LEFT_AUX_COMPONENTS.forEach((comp, i) => {
        intents.push({
          edgeId: `e-aux-shield-${comp.id}-left`,
          sourceNodeId: `comp-${comp.id}`,
          sourceSide: 'right',
          sourceHandleType: 'source',
          targetNodeId: 'agenshield',
          targetSide: 'left',
          targetHandleType: 'target',
          sourceOrderHint: shieldTopY + SHIELD_H / 2,
          targetOrderHint: shieldTopY + SHIELD_H / 2,
          edgeType: 'canvas-danger',
          edgeData: { variant: 'shield', fanout: true, balanced: true },
          targetFixedHandle: `left-aux-in-${i}`,
        });

        intents.push({
          edgeId: `e-aux-shield-${comp.id}-right`,
          sourceNodeId: 'agenshield',
          sourceSide: 'left',
          sourceHandleType: 'source',
          targetNodeId: `comp-${comp.id}`,
          targetSide: 'right',
          targetHandleType: 'target',
          sourceOrderHint: shieldTopY + SHIELD_H / 2,
          targetOrderHint: shieldTopY + SHIELD_H / 2,
          edgeType: 'canvas-danger',
          edgeData: { variant: 'shield', fanout: true, balanced: true },
          sourceFixedHandle: `left-aux-out-${i}`,
        });
      });

      // --- Right aux ↔ shield right ---
      RIGHT_AUX_COMPONENTS.forEach((comp, i) => {
        intents.push({
          edgeId: `e-aux-shield-${comp.id}-left`,
          sourceNodeId: `comp-${comp.id}`,
          sourceSide: 'left',
          sourceHandleType: 'source',
          targetNodeId: 'agenshield',
          targetSide: 'right',
          targetHandleType: 'target',
          sourceOrderHint: shieldTopY + SHIELD_H / 2,
          targetOrderHint: shieldTopY + SHIELD_H / 2,
          edgeType: 'canvas-danger',
          edgeData: { variant: 'shield', fanout: true, balanced: true },
          targetFixedHandle: `right-aux-in-${i}`,
        });

        intents.push({
          edgeId: `e-aux-shield-${comp.id}-right`,
          sourceNodeId: 'agenshield',
          sourceSide: 'right',
          sourceHandleType: 'source',
          targetNodeId: `comp-${comp.id}`,
          targetSide: 'left',
          targetHandleType: 'target',
          sourceOrderHint: shieldTopY + SHIELD_H / 2,
          targetOrderHint: shieldTopY + SHIELD_H / 2,
          edgeType: 'canvas-danger',
          edgeData: { variant: 'shield', fanout: true, balanced: true },
          sourceFixedHandle: `right-aux-out-${i}`,
        });
      });
    }

    // --- Penetration wires (unshielded broker ↔ core comp) ---
    if (topo.hasDetection) {
      const unshieldedCards = topo.cardIds.filter((id) => {
        const entry = topo.cardStatuses.find((s) => s.startsWith(`${id}:`));
        return entry?.split(':')[1] !== 'shielded';
      });

      unshieldedCards.forEach((cardId) => {
        CORE_COMPONENTS.forEach((comp) => {
          intents.push({
            edgeId: `e-pen-${cardId}-${comp.id}-up`,
            sourceNodeId: `broker-${cardId}`,
            sourceSide: 'top',
            sourceHandleType: 'source',
            targetNodeId: `comp-${comp.id}`,
            targetSide: 'bottom',
            targetHandleType: 'target',
            sourceOrderHint: contentCenterX,
            targetOrderHint: contentCenterX,
            edgeType: 'canvas-danger',
            edgeData: { variant: 'penetration', fanout: true, stubTop: 25, stubBottom: 15 },
          });

          intents.push({
            edgeId: `e-pen-${cardId}-${comp.id}-down`,
            sourceNodeId: `comp-${comp.id}`,
            sourceSide: 'bottom',
            sourceHandleType: 'source',
            targetNodeId: `broker-${cardId}`,
            targetSide: 'top',
            targetHandleType: 'target',
            sourceOrderHint: contentCenterX,
            targetOrderHint: contentCenterX,
            edgeType: 'canvas-danger',
            edgeData: { variant: 'penetration', fanout: true, stubTop: 15, stubBottom: 25 },
          });
        });
      });

      // --- Tendril wires (broker ↔ broker, adjacent only) ---
      const unshieldedBrokers = topo.cardIds.filter((id) => {
        const entry = topo.cardStatuses.find((s) => s.startsWith(`${id}:`));
        return entry?.split(':')[1] !== 'shielded';
      });

      for (let a = 0; a < unshieldedBrokers.length; a++) {
        for (let b = a + 1; b < unshieldedBrokers.length && b <= a + 1; b++) {
          intents.push({
            edgeId: `e-tendril-${unshieldedBrokers[a]}-${unshieldedBrokers[b]}`,
            sourceNodeId: `broker-${unshieldedBrokers[a]}`,
            sourceSide: 'top',
            sourceHandleType: 'source',
            targetNodeId: `broker-${unshieldedBrokers[b]}`,
            targetSide: 'top',
            targetHandleType: 'target',
            sourceOrderHint: contentCenterX,
            targetOrderHint: contentCenterX,
            edgeType: 'canvas-danger',
            edgeData: { variant: 'tendril' },
          });
        }
      }
    }

    if (intents.length === 0) return null;

    // Node dimensions for allocator
    const nodeDims = new Map<string, { width: number; height: number }>();
    SYSTEM_COMPONENTS.forEach((comp) => {
      nodeDims.set(`comp-${comp.id}`, { width: comp.w, height: comp.h });
    });
    if (topo.hasDetection) {
      topo.cardIds.forEach((id) => {
        nodeDims.set(`broker-${id}`, { width: BROKER_W, height: BROKER_H });
      });
    }

    return allocatePins(intents, nodeDims, { minPinSpacing: 8, edgeMargin: 15, intraPairGap: 5 });
  }, [topologyKey, vw, vh, isExtended]);

  /* ==================================================================
   * Phase A + C: Geometry + Build Nodes
   * ================================================================== */
  const nodes = useMemo(() => {
    const result: Node[] = [];

    if (vw === 0 || vh === 0) return result;

    // --- PCB background ---
    const bgPad = 500;
    result.push({
      id: 'pcb-background',
      type: 'canvas-pcb-background',
      position: { x: -bgPad, y: -bgPad },
      data: { width: vw + bgPad * 2, height: vh + bgPad * 2 },
      zIndex: -1,
      draggable: false,
      selectable: false,
    });

    const centerX = vw / 2;
    const panelOffset = 180;
    const contentCenterX = centerX + panelOffset;

    // --- Shield position ---
    const shieldX = contentCenterX - SHIELD_W / 2;
    const shieldTopY = vh * 0.15;

    // Flags
    const cardCount = data.hasDetection ? data.cards.length : 0;
    const shieldedCount = data.cards.filter((c) => c.status === 'shielded').length;
    const status = data.anyShielded
      ? (data.cards.every((c) => c.status === 'shielded') ? 'protected' : 'partial')
      : 'unprotected';

    const compTransition = 'transform 600ms cubic-bezier(0.4, 0, 0.2, 1), opacity 400ms ease';

    // --- 5 Core components: row ABOVE the shield ---
    {
      const totalW = CORE_COMPONENTS.reduce((a, c) => a + c.w, 0) + (CORE_COMPONENTS.length - 1) * CORE_H_GAP;
      const rowStartX = contentCenterX - totalW / 2;
      const maxH = Math.max(...CORE_COMPONENTS.map((c) => c.h));
      const rowY = shieldTopY - COMP_GAP - maxH;

      let accX = rowStartX;
      CORE_COMPONENTS.forEach((comp) => {
        const compX = accX;
        const compY = rowY + (maxH - comp.h); // Bottom-align

        const allocatedHandles = pinAllocation?.nodeHandles.get(`comp-${comp.id}`);
        const handleOverrides: HandleSpec[] | undefined = allocatedHandles
          ? [
              ...allocatedHandles,
              { id: 'left', type: 'target' as const, position: Position.Left, offset: comp.h / 2 },
              { id: 'right', type: 'target' as const, position: Position.Right, offset: comp.h / 2 },
            ]
          : undefined;

        result.push({
          id: `comp-${comp.id}`,
          type: 'canvas-system-component',
          position: { x: compX, y: compY },
          data: {
            componentType: comp.id,
            label: comp.label,
            sublabel: comp.sublabel,
            ...(handleOverrides ? { handleOverrides } : {}),
          },
          style: { transition: compTransition },
          draggable: false,
          selectable: false,
        });

        accX += comp.w + CORE_H_GAP;
      });
    }

    // --- Left auxiliaries (Secrets, PolicyGraph): stacked LEFT of shield ---
    {
      const totalH = LEFT_AUX_COMPONENTS.reduce((a, c) => a + c.h, 0) + (LEFT_AUX_COMPONENTS.length - 1) * COMP_V_GAP;
      const startY = shieldTopY + (SHIELD_H - totalH) / 2;

      LEFT_AUX_COMPONENTS.forEach((comp, i) => {
        const prevH = LEFT_AUX_COMPONENTS.slice(0, i).reduce((a, c) => a + c.h + COMP_V_GAP, 0);
        const compX = shieldX - COMP_GAP - comp.w;
        const compY = startY + prevH;

        const allocatedHandles = pinAllocation?.nodeHandles.get(`comp-${comp.id}`);
        const handleOverrides: HandleSpec[] | undefined = allocatedHandles
          ? [
              ...allocatedHandles,
              { id: 'right', type: 'source' as const, position: Position.Right, offset: comp.h / 2 },
              { id: 'left', type: 'target' as const, position: Position.Left, offset: comp.h / 2 },
            ]
          : [
              { id: 'right', type: 'source' as const, position: Position.Right, offset: comp.h / 2 },
              { id: 'bottom', type: 'source' as const, position: Position.Bottom, offset: comp.w / 2 - 3 },
              { id: 'bottom-in', type: 'target' as const, position: Position.Bottom, offset: comp.w / 2 + 3 },
              { id: 'left', type: 'target' as const, position: Position.Left, offset: comp.h / 2 },
            ];

        result.push({
          id: `comp-${comp.id}`,
          type: 'canvas-system-component',
          position: { x: compX, y: compY },
          data: {
            componentType: comp.id,
            label: comp.label,
            sublabel: comp.sublabel,
            handleOverrides,
          },
          style: {
            transition: compTransition,
            opacity: isExtended ? 1 : 0,
            pointerEvents: (isExtended ? 'auto' : 'none') as React.CSSProperties['pointerEvents'],
          },
          draggable: false,
          selectable: false,
        });
      });
    }

    // --- Right auxiliaries (Monitor, Logs): stacked RIGHT of shield ---
    {
      const totalH = RIGHT_AUX_COMPONENTS.reduce((a, c) => a + c.h, 0) + (RIGHT_AUX_COMPONENTS.length - 1) * COMP_V_GAP;
      const startY = shieldTopY + (SHIELD_H - totalH) / 2;

      RIGHT_AUX_COMPONENTS.forEach((comp, i) => {
        const prevH = RIGHT_AUX_COMPONENTS.slice(0, i).reduce((a, c) => a + c.h + COMP_V_GAP, 0);
        const compX = shieldX + SHIELD_W + COMP_GAP;
        const compY = startY + prevH;

        const allocatedHandles = pinAllocation?.nodeHandles.get(`comp-${comp.id}`);
        const handleOverrides: HandleSpec[] | undefined = allocatedHandles
          ? [
              ...allocatedHandles,
              { id: 'left', type: 'source' as const, position: Position.Left, offset: comp.h / 2 },
              { id: 'right', type: 'target' as const, position: Position.Right, offset: comp.h / 2 },
            ]
          : [
              { id: 'left', type: 'source' as const, position: Position.Left, offset: comp.h / 2 },
              { id: 'bottom', type: 'source' as const, position: Position.Bottom, offset: comp.w / 2 - 3 },
              { id: 'bottom-in', type: 'target' as const, position: Position.Bottom, offset: comp.w / 2 + 3 },
              { id: 'right', type: 'target' as const, position: Position.Right, offset: comp.h / 2 },
            ];

        result.push({
          id: `comp-${comp.id}`,
          type: 'canvas-system-component',
          position: { x: compX, y: compY },
          data: {
            componentType: comp.id,
            label: comp.label,
            sublabel: comp.sublabel,
            handleOverrides,
          },
          style: {
            transition: compTransition,
            opacity: isExtended ? 1 : 0,
            pointerEvents: (isExtended ? 'auto' : 'none') as React.CSSProperties['pointerEvents'],
          },
          draggable: false,
          selectable: false,
        });
      });
    }

    // --- Compute handle positions for shield ---

    // Top handles: 5 core components
    const topOffsets = distributeHandles(CORE_COMPONENTS.length, TOP_HANDLE_RANGE);
    const topHandles: HandleSpec[] = [];
    CORE_COMPONENTS.forEach((_, i) => {
      topHandles.push({
        id: `core-in-${i}`,
        type: 'target',
        position: Position.Top,
        offset: topOffsets[i],
      });
      topHandles.push({
        id: `core-out-${i}`,
        type: 'source',
        position: Position.Top,
        offset: topOffsets[i] + 4,
      });
    });

    // Bottom handles: N brokers
    const bottomOffsets = distributeHandles(cardCount, BOTTOM_HANDLE_RANGE);
    const bottomHandles: HandleSpec[] = [];
    for (let i = 0; i < cardCount; i++) {
      bottomHandles.push({
        id: `bottom-broker-${i}`,
        type: 'source',
        position: Position.Bottom,
        offset: bottomOffsets[i],
      });
    }

    // Left handles: N left auxiliary components
    const leftOffsets = distributeHandles(LEFT_AUX_COMPONENTS.length, LEFT_HANDLE_RANGE);
    const leftHandles: HandleSpec[] = [];
    LEFT_AUX_COMPONENTS.forEach((_, i) => {
      leftHandles.push({
        id: `left-aux-in-${i}`,
        type: 'target',
        position: Position.Left,
        offset: leftOffsets[i],
      });
      leftHandles.push({
        id: `left-aux-out-${i}`,
        type: 'source',
        position: Position.Left,
        offset: leftOffsets[i] + 4,
      });
    });

    // Right handles: N right auxiliary components
    const rightOffsets = distributeHandles(RIGHT_AUX_COMPONENTS.length, RIGHT_HANDLE_RANGE);
    const rightHandles: HandleSpec[] = [];
    RIGHT_AUX_COMPONENTS.forEach((_, i) => {
      rightHandles.push({
        id: `right-aux-in-${i}`,
        type: 'target',
        position: Position.Right,
        offset: rightOffsets[i],
      });
      rightHandles.push({
        id: `right-aux-out-${i}`,
        type: 'source',
        position: Position.Right,
        offset: rightOffsets[i] + 4,
      });
    });

    // --- AgenShield (shield logo hub) ---
    result.push({
      id: 'agenshield',
      type: 'canvas-agenshield',
      position: { x: shieldX, y: shieldTopY },
      data: {
        width: SHIELD_W,
        height: SHIELD_H,
        status,
        daemonRunning: data.daemonRunning,
        shieldedCount,
        totalCount: cardCount,
        topHandles,
        bottomHandles,
        leftHandles,
        rightHandles,
      },
      draggable: false,
      selectable: false,
    });

    // --- Broker-wrapped cards (row below shield) ---
    if (data.hasDetection && cardCount > 0) {
      const brokerStartY = shieldTopY + SHIELD_H + BROKER_GAP;
      const brokerRowW = cardCount * BROKER_W + (cardCount - 1) * BROKER_H_GAP;
      const brokerStartX = contentCenterX - brokerRowW / 2;

      data.cards.forEach((card, i) => {
        const brokerX = brokerStartX + i * (BROKER_W + BROKER_H_GAP);

        const brokerHandleOverrides = pinAllocation?.nodeHandles.get(`broker-${card.id}`);

        result.push({
          id: `broker-${card.id}`,
          type: 'canvas-broker-card',
          position: { x: brokerX, y: brokerStartY },
          data: {
            id: card.id,
            name: card.name,
            type: card.type,
            icon: card.icon,
            status: card.status,
            isRunning: card.isRunning,
            ...(brokerHandleOverrides ? { handleOverrides: brokerHandleOverrides } : {}),
          },
          draggable: false,
          selectable: false,
        });
      });
    }

    return result;
  }, [data, vw, vh, isExtended, pinAllocation]);

  /* ==================================================================
   * Phase D: Build Edges
   * ================================================================== */
  const edges = useMemo(() => {
    const result: Edge[] = [];

    if (vw === 0 || vh === 0) return result;

    const topo = JSON.parse(topologyKey) as {
      cardIds: string[];
      cardStatuses: string[];
      hasDetection: boolean;
      anyShielded: boolean;
      anyUnshielded: boolean;
    };

    const getAllocatedHandles = (edgeId: string) =>
      pinAllocation?.edgeHandles.get(edgeId);

    // --- Green shield connections ---
    if (topo.anyShielded) {
      // Core components ↔ shield top
      CORE_COMPONENTS.forEach((comp, i) => {
        const downId = `e-comp-shield-${comp.id}-down`;
        const upId = `e-comp-shield-${comp.id}-up`;
        const downHandles = getAllocatedHandles(downId);
        const upHandles = getAllocatedHandles(upId);

        result.push({
          id: downId,
          source: `comp-${comp.id}`,
          target: 'agenshield',
          sourceHandle: downHandles?.sourceHandle ?? 'bottom',
          targetHandle: downHandles?.targetHandle ?? `core-in-${i}`,
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true },
        });

        result.push({
          id: upId,
          source: 'agenshield',
          target: `comp-${comp.id}`,
          sourceHandle: upHandles?.sourceHandle ?? `core-out-${i}`,
          targetHandle: upHandles?.targetHandle ?? 'bottom-in',
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true },
        });
      });

      // Left aux ↔ shield left
      LEFT_AUX_COMPONENTS.forEach((comp, i) => {
        const leftId = `e-aux-shield-${comp.id}-left`;
        const rightId = `e-aux-shield-${comp.id}-right`;
        const leftHandles = getAllocatedHandles(leftId);
        const rightHandles = getAllocatedHandles(rightId);

        result.push({
          id: leftId,
          source: `comp-${comp.id}`,
          target: 'agenshield',
          sourceHandle: leftHandles?.sourceHandle ?? 'right',
          targetHandle: leftHandles?.targetHandle ?? `left-aux-in-${i}`,
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true },
        });

        result.push({
          id: rightId,
          source: 'agenshield',
          target: `comp-${comp.id}`,
          sourceHandle: rightHandles?.sourceHandle ?? `left-aux-out-${i}`,
          targetHandle: rightHandles?.targetHandle ?? 'right',
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true },
        });
      });

      // Right aux ↔ shield right
      RIGHT_AUX_COMPONENTS.forEach((comp, i) => {
        const leftId = `e-aux-shield-${comp.id}-left`;
        const rightId = `e-aux-shield-${comp.id}-right`;
        const leftHandles = getAllocatedHandles(leftId);
        const rightHandles = getAllocatedHandles(rightId);

        result.push({
          id: leftId,
          source: `comp-${comp.id}`,
          target: 'agenshield',
          sourceHandle: leftHandles?.sourceHandle ?? 'left',
          targetHandle: leftHandles?.targetHandle ?? `right-aux-in-${i}`,
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true },
        });

        result.push({
          id: rightId,
          source: 'agenshield',
          target: `comp-${comp.id}`,
          sourceHandle: rightHandles?.sourceHandle ?? `right-aux-out-${i}`,
          targetHandle: rightHandles?.targetHandle ?? 'left',
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true },
        });
      });
    }

    // --- AgenShield -> Brokers (traffic/danger wires) ---
    if (topo.hasDetection) {
      topo.cardIds.forEach((cardId, i) => {
        const statusEntry = topo.cardStatuses.find((s) => s.startsWith(`${cardId}:`));
        const cardStatus = statusEntry?.split(':')[1] ?? 'unshielded';
        const isShielded = cardStatus === 'shielded';

        // Handle ID for this broker on the shield
        const shieldHandle = `bottom-broker-${i}`;
        const brokerBusHandle = 'top-bus';

        if (isShielded) {
          // Shielded: traffic wires from AgenShield -> Broker
          const channelOffsets = Array.from(
            { length: WIRE_COUNT },
            (_, w) => (w - (WIRE_COUNT - 1) / 2) * WIRE_SPACING,
          );

          channelOffsets.forEach((offset, w) => {
            result.push({
              id: `e-shield-broker-${cardId}-${w}`,
              source: 'agenshield',
              target: `broker-${cardId}`,
              sourceHandle: shieldHandle,
              targetHandle: brokerBusHandle,
              type: 'canvas-traffic',
              data: { channelOffset: offset },
              style: { opacity: 0.5 },
            });
          });
        } else {
          // Unshielded: danger primary wires
          const dangerOffsets = Array.from(
            { length: DANGER_WIRE_COUNT },
            (_, w) => (w - (DANGER_WIRE_COUNT - 1) / 2) * DANGER_WIRE_SPACING,
          );

          dangerOffsets.forEach((offset, w) => {
            result.push({
              id: `e-shield-broker-${cardId}-${w}`,
              source: 'agenshield',
              target: `broker-${cardId}`,
              sourceHandle: shieldHandle,
              targetHandle: brokerBusHandle,
              type: 'canvas-danger',
              data: { variant: 'primary', channelOffset: offset },
            });
          });

          // Penetration wires: broker <-> each core component
          CORE_COMPONENTS.forEach((comp) => {
            const upId = `e-pen-${cardId}-${comp.id}-up`;
            const downId = `e-pen-${cardId}-${comp.id}-down`;
            const upHandles = getAllocatedHandles(upId);
            const downHandles = getAllocatedHandles(downId);

            result.push({
              id: upId,
              source: `broker-${cardId}`,
              target: `comp-${comp.id}`,
              sourceHandle: upHandles?.sourceHandle ?? 'danger-up',
              targetHandle: upHandles?.targetHandle ?? 'bottom-in',
              type: 'canvas-danger',
              data: { variant: 'penetration', fanout: true, stubTop: 25, stubBottom: 15 },
            });

            result.push({
              id: downId,
              source: `comp-${comp.id}`,
              target: `broker-${cardId}`,
              sourceHandle: downHandles?.sourceHandle ?? 'bottom',
              targetHandle: downHandles?.targetHandle ?? 'danger-up-in',
              type: 'canvas-danger',
              data: { variant: 'penetration', fanout: true, stubTop: 15, stubBottom: 25 },
            });
          });
        }
      });

      // Cross-contamination tendrils — adjacent brokers only
      const unshieldedBrokers: string[] = [];
      topo.cardIds.forEach((cardId) => {
        const statusEntry = topo.cardStatuses.find((s) => s.startsWith(`${cardId}:`));
        const st = statusEntry?.split(':')[1] ?? 'unshielded';
        if (st !== 'shielded') unshieldedBrokers.push(cardId);
      });

      for (let a = 0; a < unshieldedBrokers.length; a++) {
        for (let b = a + 1; b < unshieldedBrokers.length && b <= a + 1; b++) {
          const idA = unshieldedBrokers[a];
          const idB = unshieldedBrokers[b];
          const tendrilId = `e-tendril-${idA}-${idB}`;
          const tendrilHandles = getAllocatedHandles(tendrilId);

          result.push({
            id: tendrilId,
            source: `broker-${idA}`,
            target: `broker-${idB}`,
            sourceHandle: tendrilHandles?.sourceHandle ?? 'danger-top-out',
            targetHandle: tendrilHandles?.targetHandle ?? 'danger-bottom-in',
            type: 'canvas-danger',
            data: { variant: 'tendril' },
          });
        }
      }
    }

    return result;
  }, [topologyKey, vw, vh, pinAllocation]);

  return { nodes, edges };
}
