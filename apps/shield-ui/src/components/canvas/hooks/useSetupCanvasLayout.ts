/**
 * Computes node and edge positions for the setup canvas topology.
 *
 * Layout:
 *   [7 System Component Nodes in a row]
 *   CPU  NET  CMD  FS  MEM  MON  LOG
 *    |    |    |   |    |    |    |
 *   [dark green shield connections]
 *    |    |    |   |    |    |    |
 *   ========= AgenShield =========
 *   /  \                        /  \
 *  Card  Card                Card  Card
 *
 * No PSU. No ShieldChip nodes.
 * Shielded cards connect directly through AgenShield (clean gray wires).
 * Unshielded cards bypass AgenShield (red danger wires) + penetration wires to components.
 */

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { SetupCanvasData, SystemComponentType } from '../Canvas.types';

interface ViewportSize {
  width: number;
  height: number;
}

/* ---- System component definitions (must match VARIANTS in SystemComponentNode) ---- */
const SYSTEM_COMPONENTS: { id: SystemComponentType; label: string; sublabel: string; w: number; h: number }[] = [
  { id: 'cpu', label: 'CPU', sublabel: 'Process', w: 140, h: 120 },
  { id: 'network', label: 'NETWORK', sublabel: 'eth0', w: 150, h: 90 },
  { id: 'command', label: 'CMD EXEC', sublabel: 'shell', w: 120, h: 90 },
  { id: 'filesystem', label: 'DISK', sublabel: 'nvme0', w: 150, h: 95 },
  { id: 'memory', label: 'MEMORY', sublabel: 'DDR5', w: 165, h: 70 },
  { id: 'monitoring', label: 'MONITOR', sublabel: 'sys', w: 115, h: 90 },
  { id: 'logs', label: 'LOGS', sublabel: 'syslog', w: 115, h: 90 },
];

const COMP_GAP = 20;
const COMP_TO_SHIELD_GAP = 160;

/* ---- AgenShield (central hub) dimensions ---- */
const SHIELD_W = 80;
const SHIELD_TOP_PAD = 60;
const SHIELD_BOTTOM_PAD = 30;
const SHIELD_MIN_H = 200;

/* ---- Card dimensions (must match ApplicationCardNode) ---- */
const CARD_W = 300;
const CARD_PIN_EXT = 9;
const CARD_H = 180;

/* ---- Spacing ---- */
const ROW_SPACING = 200;
const SHIELD_TO_CARD_GAP = 50;

/* ---- Wire routing ---- */
const WIRE_COUNT = 3;
const WIRE_SPACING = 4;
const DANGER_WIRE_COUNT = 3;
const DANGER_WIRE_SPACING = 4;

export function useSetupCanvasLayout(data: SetupCanvasData, viewport: ViewportSize) {
  const { width: vw, height: vh } = viewport;

  /* ---- Shared layout constants (used by both nodes & edges useMemo) ---- */
  const compY = vh * 0.04;
  const maxCompH = Math.max(...SYSTEM_COMPONENTS.map((c) => c.h));
  const shieldTopY = compY + maxCompH + COMP_TO_SHIELD_GAP;

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

  const nodes = useMemo(() => {
    const result: Node[] = [];

    if (vw === 0 || vh === 0) return result;

    // --- PCB background ---
    const bgPad = 50;
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

    // --- Compute total component row width ---
    const totalCompW = SYSTEM_COMPONENTS.reduce((a, c) => a + c.w, 0) + COMP_GAP * (SYSTEM_COMPONENTS.length - 1);

    // --- X positions (centered) ---
    const compStartX = contentCenterX - totalCompW / 2;
    const shieldX = contentCenterX - SHIELD_W / 2;

    // --- Card count and shield sizing ---
    const cardCount = data.hasDetection ? data.cards.length : 0;
    const rowCount = Math.ceil(cardCount / 2);
    const leftCount = Math.ceil(cardCount / 2);
    const rightCount = Math.floor(cardCount / 2);

    const shieldHeight = Math.max(
      SHIELD_MIN_H,
      SHIELD_TOP_PAD + Math.max(0, rowCount - 1) * ROW_SPACING + SHIELD_BOTTOM_PAD,
    );

    // Flags
    const hasAnyUnshielded = data.anyUnshielded;
    const unshieldedCount = data.cards.filter((c) => c.status !== 'shielded').length;
    const shieldedCount = data.cards.filter((c) => c.status === 'shielded').length;

    // --- System Component Nodes (7 in a row) ---
    const compCenterXs: number[] = [];
    let cx = compStartX;
    SYSTEM_COMPONENTS.forEach((comp) => {
      compCenterXs.push(cx + comp.w / 2);
      result.push({
        id: `comp-${comp.id}`,
        type: 'canvas-system-component',
        position: { x: cx, y: compY },
        data: {
          componentType: comp.id,
          label: comp.label,
          sublabel: comp.sublabel,
          exposed: hasAnyUnshielded,
          exposedCount: unshieldedCount,
        },
        draggable: false,
        selectable: false,
      });
      cx += comp.w + COMP_GAP;
    });

    // --- Crossbar: 2× stem width, handles evenly distributed within ---
    const crossbarWidth = SHIELD_W * 2;
    const cbPad = 10;
    const cbSpan = crossbarWidth - cbPad * 2;
    const compCount = SYSTEM_COMPONENTS.length;
    const compHandleXs = SYSTEM_COMPONENTS.map((_, i) =>
      (SHIELD_W / 2 - crossbarWidth / 2) + cbPad + (compCount > 1 ? i * (cbSpan / (compCount - 1)) : cbSpan / 2),
    );

    // --- AgenShield (central hub) ---
    result.push({
      id: 'agenshield',
      type: 'canvas-agenshield',
      position: { x: shieldX, y: shieldTopY },
      data: {
        height: shieldHeight,
        leftHandleCount: leftCount,
        rightHandleCount: rightCount,
        status: data.anyShielded
          ? (data.cards.every((c) => c.status === 'shielded') ? 'protected' : 'partial')
          : 'unprotected',
        shieldedCount,
        totalCount: cardCount,
        compHandleXs,
        crossbarWidth,
      },
      draggable: false,
      selectable: false,
    });

    // --- Application Cards (direct connection, no shield chips) ---
    if (data.hasDetection) {
      data.cards.forEach((card, i) => {
        const row = Math.floor(i / 2);
        const side = i % 2 === 0 ? 'left' : 'right';

        const handleY = SHIELD_TOP_PAD + row * ROW_SPACING;
        const cardCenterY = shieldTopY + handleY;
        const cardY = cardCenterY - CARD_H / 2;

        if (side === 'left') {
          const cardX = shieldX - SHIELD_TO_CARD_GAP - (CARD_W + CARD_PIN_EXT);
          result.push({
            id: `card-${card.id}`,
            type: 'canvas-application-card',
            position: { x: cardX, y: cardY },
            data: { ...card, side: 'left', selected: false },
            draggable: false,
            selectable: false,
          });
        } else {
          const cardX = shieldX + SHIELD_W + SHIELD_TO_CARD_GAP;
          result.push({
            id: `card-${card.id}`,
            type: 'canvas-application-card',
            position: { x: cardX, y: cardY },
            data: { ...card, side: 'right', selected: false },
            draggable: false,
            selectable: false,
          });
        }
      });
    }

    return result;
  }, [data, vw, vh]);

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

    // --- Green shield connections: Components <-> AgenShield (bidirectional) ---
    SYSTEM_COMPONENTS.forEach((comp, i) => {
      const baseOffset = (i - 3) * 2;

      // Wire DOWN: component → shield (shots travel downward)
      result.push({
        id: `e-comp-shield-${comp.id}-down`,
        source: `comp-${comp.id}`,
        target: 'agenshield',
        sourceHandle: 'bottom',
        targetHandle: `comp-in-${i}`,
        type: 'canvas-danger',
        data: { variant: 'shield', channelOffset: baseOffset },
      });

      // Wire UP: shield → component (shots travel upward)
      result.push({
        id: `e-comp-shield-${comp.id}-up`,
        source: 'agenshield',
        target: `comp-${comp.id}`,
        sourceHandle: `comp-out-${i}`,
        targetHandle: 'bottom-in',
        type: 'canvas-danger',
        data: { variant: 'shield', channelOffset: baseOffset + 1 },
      });
    });

    // --- AgenShield -> Cards ---
    if (topo.hasDetection) {
      const unshieldedIndices: number[] = [];

      topo.cardIds.forEach((cardId, i) => {
        const statusEntry = topo.cardStatuses.find((s) => s.startsWith(`${cardId}:`));
        const status = statusEntry?.split(':')[1] ?? 'unshielded';
        const isShielded = status === 'shielded';
        const row = Math.floor(i / 2);
        const side = i % 2 === 0 ? 'left' : 'right';
        const busHandle = `${side}-${row}`;

        if (isShielded) {
          // Shielded: clean gray traffic wires from AgenShield -> Card
          const channelOffsets = Array.from(
            { length: WIRE_COUNT },
            (_, w) => (w - (WIRE_COUNT - 1) / 2) * WIRE_SPACING,
          );

          const cardHandle = side === 'left' ? 'right-bus' : 'left-bus';
          channelOffsets.forEach((offset, w) => {
            result.push({
              id: `e-shield-card-${cardId}-${w}`,
              source: 'agenshield',
              target: `card-${cardId}`,
              sourceHandle: busHandle,
              targetHandle: cardHandle,
              type: 'canvas-traffic',
              data: { channelOffset: offset },
              style: { opacity: 0.5 },
            });
          });
        } else {
          unshieldedIndices.push(i);

          // Unshielded: red danger primary wires from AgenShield to card
          const dangerOffsets = Array.from(
            { length: DANGER_WIRE_COUNT },
            (_, w) => (w - (DANGER_WIRE_COUNT - 1) / 2) * DANGER_WIRE_SPACING,
          );

          const cardHandle = side === 'left' ? 'right-bus' : 'left-bus';
          dangerOffsets.forEach((offset, w) => {
            result.push({
              id: `e-shield-card-${cardId}-${w}`,
              source: 'agenshield',
              target: `card-${cardId}`,
              sourceHandle: busHandle,
              targetHandle: cardHandle,
              type: 'canvas-danger',
              data: { variant: 'primary', channelOffset: offset },
            });
          });

          // Penetration wires: bidirectional card <-> each system component
          SYSTEM_COMPONENTS.forEach((comp, compIdx) => {
            const baseOffset = (compIdx - 3) * 2;

            // Wire UP: card → component (existing direction)
            result.push({
              id: `e-pen-${cardId}-${comp.id}-up`,
              source: `card-${cardId}`,
              target: `comp-${comp.id}`,
              sourceHandle: 'danger-up',
              targetHandle: 'bottom-in',
              type: 'canvas-danger',
              data: {
                variant: 'penetration',
                channelOffset: baseOffset,
                channelCenterY: compY + maxCompH + COMP_TO_SHIELD_GAP / 2,
              },
            });

            // Wire DOWN: component → card (return direction)
            result.push({
              id: `e-pen-${cardId}-${comp.id}-down`,
              source: `comp-${comp.id}`,
              target: `card-${cardId}`,
              sourceHandle: 'bottom',
              targetHandle: 'danger-up-in',
              type: 'canvas-danger',
              data: {
                variant: 'penetration',
                channelOffset: baseOffset + 1,
                channelCenterY: compY + maxCompH + COMP_TO_SHIELD_GAP / 2,
              },
            });
          });
        }
      });

      // Cross-contamination tendrils between adjacent unshielded cards
      for (let a = 0; a < unshieldedIndices.length; a++) {
        for (let b = a + 1; b < unshieldedIndices.length && b <= a + 2; b++) {
          const idA = topo.cardIds[unshieldedIndices[a]];
          const idB = topo.cardIds[unshieldedIndices[b]];
          result.push({
            id: `e-tendril-${idA}-${idB}`,
            source: `card-${idA}`,
            target: `card-${idB}`,
            sourceHandle: 'danger-top-out',
            targetHandle: 'danger-bottom-in',
            type: 'canvas-danger',
            data: { variant: 'tendril' },
          });
        }
      }
    }

    return result;
  }, [topologyKey, vw, vh]);

  return { nodes, edges };
}
