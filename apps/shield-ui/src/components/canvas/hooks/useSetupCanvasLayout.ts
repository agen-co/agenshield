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
 *          [CPU] [NET] [FS] [MEM]
 *                     │
 *  SEC ──┐       ┌────┴────┐       ┌── MON
 *  POL ──┘───────│  SHIELD │───────└── SKL
 *                └────┬────┘
 *                     │
 *              [Broker][Broker]
 *
 * Core components above the shield (4), connecting to top handles.
 * Auxiliary components on left/right sides of shield.
 * Broker-wrapped cards below the shield.
 */

import { useMemo, useEffect } from 'react';
import { Position, type Node, type Edge } from '@xyflow/react';

import type { SetupCanvasData, SystemComponentType, ConnectionIntent, HandleSpec } from '../Canvas.types';
import { VARIANTS } from '../nodes/SystemComponentNode/system.constants';
import { METRICS_CLUSTER_DIMS } from '../nodes/MetricsClusterNode';
import { useSnapshot } from 'valtio';
import { setAllExposed, setExtendedComponentsActive, systemStore, type ComponentHealth } from '../../../state/system-store';
import { allocatePins } from '../utils/pinAllocator';

/* ---- Health → wire color mapping ---- */
const HEALTH_EDGE_COLORS: Record<ComponentHealth, { stroke: string; electric: string }> = {
  ok:     { stroke: '#2D6B3F', electric: '#3DA05A' },
  warn:   { stroke: '#E8B84A', electric: '#F0C95C' },
  danger: { stroke: '#E1583E', electric: '#FF6B4F' },
};

interface ViewportSize {
  width: number;
  height: number;
}

/* ---- System component definitions — w/h from VARIANTS registry ---- */
const SYSTEM_COMPONENTS: { id: SystemComponentType; label: string; sublabel: string; w: number; h: number }[] = [
  { id: 'cpu', label: 'CPU', sublabel: 'Process', w: VARIANTS.cpu.w, h: VARIANTS.cpu.h },
  { id: 'network', label: 'NETWORK', sublabel: 'eth0', w: VARIANTS.network.w, h: VARIANTS.network.h },
  { id: 'filesystem', label: 'DISK', sublabel: 'nvme0', w: VARIANTS.filesystem.w, h: VARIANTS.filesystem.h },
  { id: 'memory', label: 'MEMORY', sublabel: 'DDR5', w: VARIANTS.memory.w, h: VARIANTS.memory.h },
  { id: 'monitoring', label: 'MONITOR', sublabel: 'sys', w: VARIANTS.monitoring.w, h: VARIANTS.monitoring.h },
  { id: 'skills', label: 'SKILLS', sublabel: 'tools', w: VARIANTS.skills.w, h: VARIANTS.skills.h },
  { id: 'secrets', label: 'SECRETS', sublabel: 'vault', w: VARIANTS.secrets.w, h: VARIANTS.secrets.h },
  { id: 'policy-graph', label: 'POLICY', sublabel: 'rules', w: VARIANTS['policy-graph'].w, h: VARIANTS['policy-graph'].h },
];

const findComp = (id: SystemComponentType) => SYSTEM_COMPONENTS.find((c) => c.id === id)!;
const filterComps = (ids: SystemComponentType[]) => SYSTEM_COMPONENTS.filter((c) => ids.includes(c.id));

/** Secrets, PolicyGraph on left side of shield */
const LEFT_AUX_COMPONENTS = filterComps(['secrets', 'policy-graph']);
/** Monitor, Logs on right side of shield */
const RIGHT_AUX_COMPONENTS = filterComps(['monitoring', 'skills']);

/* ---- Shield dimension constants ---- */
const SHIELD_W = 350;
const SHIELD_H = 350;

/* ---- Component positioning ---- */
const COMP_GAP = 60;           // Gap between component and shield edge
const COMP_V_GAP = 20;        // Vertical gap between stacked components
const BROKER_GAP = 80;        // Gap from shield bottom to broker row
const BROKER_H_GAP = 40;      // Horizontal gap between brokers
const BROKER_W = 180;
const BROKER_H = 120;

/* ---- Wire routing ---- */

/* ---- Shield contour helpers (viewBox 0 0 200, SCALE=1.75 → 350px node) ---- */
const SCALE = SHIELD_W / 200;

/** Interpolate Y on the shield's top crown at a given SVG X */
function shieldCrownY(svgX: number): number {
  if (svgX <= 90.9) return 15.66 + (svgX - 65.46) / (90.886 - 65.46) * (6.6 - 15.66);
  if (svgX <= 100)  return 6.6 + (svgX - 90.886) / (100 - 90.886) * (4.5 - 6.6);
  if (svgX <= 109.1) return 4.5 + (svgX - 100) / (109.145 - 100) * (6.577 - 4.5);
  return 6.577 + (svgX - 109.145) / (134.526 - 109.145) * (15.616 - 6.577);
}

/** Interpolate Y on the shield's bottom curve at a given SVG X */
function shieldBottomCurveY(svgX: number): number {
  // Parabolic fit through (41.55,162.47), (100,195.5), (158.45,162.46)
  const t = (svgX - 100) / 58.45;
  return 195.5 - t * t * 33;
}

/** Top handle SVG X position for metrics cluster (crown tip) */
const METRICS_HANDLE_SVG_X = 100;

/** Left wing edge SVG X */
const LEFT_WING_SVG_X = 21.2;
/** Right wing edge SVG X */
const RIGHT_WING_SVG_X = 178.8;
/** Left/Right aux SVG Y positions */
const AUX_SVG_Y = [61.3, 84.6];

/* ---- Fixed layout center (viewport-independent so fitView can zoom) ---- */
const LAYOUT_CENTER_X = 500;

/** Shield Y = offset below the metrics cluster node (viewport-independent) */
function computeShieldTopY(_hasBrokers: boolean): number {
  return COMP_GAP + METRICS_CLUSTER_DIMS.h;
}

export function useSetupCanvasLayout(data: SetupCanvasData, viewport: ViewportSize) {
  const { width: vw, height: vh } = viewport;
  const systemStoreSnap = useSnapshot(systemStore);

  // Sync exposed state to unified valtio store
  const hasAnyUnshielded = data.anyUnshielded;
  useEffect(() => {
    setAllExposed(hasAnyUnshielded);
  }, [hasAnyUnshielded]);

  // Show auxiliary components only when AgenShield is active (at least one shielded card or forced open)
  const hasAnyShielded = data.anyShielded;
  const wingsForced = systemStoreSnap.wingsForceOpen;
  useEffect(() => {
    setExtendedComponentsActive(hasAnyShielded || wingsForced);
  }, [hasAnyShielded, wingsForced]);

  const isExtended = data.anyShielded || wingsForced;

  const topologyKey = useMemo(
    () =>
      JSON.stringify({
        cardIds: data.cards.map((c) => c.id),
        cardStatuses: data.cards.map((c) => `${c.id}:${c.status}`),
        stoppedIds: data.stoppedShieldedCards.map((c) => c.id),
        dismissedCount: data.dismissedCardIds.length,
        hasDetection: data.hasDetection,
        anyShielded: data.anyShielded,
        anyUnshielded: data.anyUnshielded,
        isExtended,
      }),
    [data.cards, data.stoppedShieldedCards, data.dismissedCardIds, data.hasDetection, data.anyShielded, data.anyUnshielded, isExtended],
  );

  /* ==================================================================
   * Phase B: Pin Allocation
   * ================================================================== */
  const pinAllocation = useMemo(() => {
    if (vw === 0 || vh === 0) return null;

    const topo = JSON.parse(topologyKey) as {
      cardIds: string[];
      cardStatuses: string[];
      stoppedIds: string[];
      dismissedCount: number;
      hasDetection: boolean;
      anyShielded: boolean;
      anyUnshielded: boolean;
      isExtended: boolean;
    };

    if (!topo.hasDetection && !topo.anyShielded && !topo.isExtended) return null;

    const contentCenterX = LAYOUT_CENTER_X;
    const shieldX = contentCenterX - SHIELD_W / 2;
    const hasBrokers = topo.hasDetection && (topo.cardIds.length > 0 || topo.stoppedIds.length > 0);
    const shieldTopY = computeShieldTopY(hasBrokers);

    const intents: ConnectionIntent[] = [];

    // --- Metrics cluster ↔ shield top ---
    if (topo.anyShielded || topo.isExtended) {
      intents.push({
        edgeId: 'e-metrics-shield-down',
        sourceNodeId: 'metrics-cluster',
        sourceSide: 'bottom',
        sourceHandleType: 'source',
        targetNodeId: 'agenshield',
        targetSide: 'top',
        targetHandleType: 'target',
        sourceOrderHint: contentCenterX,
        targetOrderHint: contentCenterX,
        edgeType: 'canvas-danger',
        edgeData: { variant: 'shield', fanout: true, balanced: true },
        targetFixedHandle: 'metrics-in',
      });

      intents.push({
        edgeId: 'e-metrics-shield-up',
        sourceNodeId: 'agenshield',
        sourceSide: 'top',
        sourceHandleType: 'source',
        targetNodeId: 'metrics-cluster',
        targetSide: 'bottom',
        targetHandleType: 'target',
        sourceOrderHint: contentCenterX,
        targetOrderHint: contentCenterX,
        edgeType: 'canvas-danger',
        edgeData: { variant: 'shield', fanout: true, balanced: true },
        sourceFixedHandle: 'metrics-out',
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

    // --- Penetration wires (unshielded main-row broker ↔ metrics cluster) ---
    // In CLI setup mode, skip all penetration/tendril wires — cards float
    // without connections until they become shielded.
    if (topo.hasDetection && !false) {
      const unshieldedCards = topo.cardIds.filter((id) => {
        const entry = topo.cardStatuses.find((s) => s.startsWith(`${id}:`));
        return entry?.split(':')[1] === 'unshielded';
      });

      unshieldedCards.forEach((cardId) => {
        intents.push({
          edgeId: `e-pen-${cardId}-metrics-up`,
          sourceNodeId: `broker-${cardId}`,
          sourceSide: 'top',
          sourceHandleType: 'source',
          targetNodeId: 'metrics-cluster',
          targetSide: 'bottom',
          targetHandleType: 'target',
          sourceOrderHint: contentCenterX,
          targetOrderHint: contentCenterX,
          edgeType: 'canvas-danger',
          edgeData: { variant: 'penetration', fanout: true, stubTop: 25, stubBottom: 15 },
        });

        intents.push({
          edgeId: `e-pen-${cardId}-metrics-down`,
          sourceNodeId: 'metrics-cluster',
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

      // --- Tendril wires (broker ↔ broker, adjacent only, main row only) ---
      const unshieldedBrokers = topo.cardIds.filter((id) => {
        const entry = topo.cardStatuses.find((s) => s.startsWith(`${id}:`));
        return entry?.split(':')[1] === 'unshielded';
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
    // Auxiliary components (left/right of shield)
    [...LEFT_AUX_COMPONENTS, ...RIGHT_AUX_COMPONENTS].forEach((comp) => {
      nodeDims.set(`comp-${comp.id}`, { width: comp.w, height: comp.h });
    });
    // Metrics cluster (above shield)
    nodeDims.set('metrics-cluster', { width: METRICS_CLUSTER_DIMS.w, height: METRICS_CLUSTER_DIMS.h });
    if (topo.hasDetection) {
      // Main row brokers
      topo.cardIds.forEach((id) => {
        nodeDims.set(`broker-${id}`, { width: BROKER_W, height: BROKER_H });
      });
      // Stopped-shielded row brokers
      topo.stoppedIds.forEach((id) => {
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

    const contentCenterX = LAYOUT_CENTER_X;

    // --- Shield position ---
    const shieldX = contentCenterX - SHIELD_W / 2;
    const mainCardCount = data.hasDetection ? data.cards.length : 0;
    const stoppedCardCount = data.stoppedShieldedCards.length;
    const totalVisibleCards = mainCardCount + stoppedCardCount;
    const hasBrokers = data.hasDetection && totalVisibleCards > 0;
    const shieldTopY = computeShieldTopY(hasBrokers);

    // Flags
    const allVisibleCards = [...data.cards, ...data.stoppedShieldedCards];
    const shieldedCount = allVisibleCards.filter((c) => c.status === 'shielded').length;
    const status = data.anyShielded
      ? (allVisibleCards.every((c) => c.status === 'shielded') ? 'protected' : 'partial')
      : 'unprotected';

    // --- Metrics Cluster: unified node ABOVE the shield ---
    {
      const clusterW = METRICS_CLUSTER_DIMS.w;
      const clusterH = METRICS_CLUSTER_DIMS.h;
      const clusterY = shieldTopY - COMP_GAP - clusterH;

      const allocatedHandles = pinAllocation?.nodeHandles.get('metrics-cluster');

      result.push({
        id: 'metrics-cluster',
        type: 'canvas-metrics-cluster',
        position: {
          x: contentCenterX - clusterW / 2,
          y: clusterY,
        },
        width: clusterW,
        height: clusterH,
        data: {
          ...(allocatedHandles ? { handleOverrides: allocatedHandles } : {}),
        },
        draggable: false,
        selectable: false,
        zIndex: 5,
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
          width: comp.w,
          height: comp.h,
          data: {
            componentType: comp.id,
            label: comp.label,
            sublabel: comp.sublabel,
            handleOverrides,
          },
          style: {
            opacity: isExtended ? 1 : 0,
            transition: 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
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
          width: comp.w,
          height: comp.h,
          data: {
            componentType: comp.id,
            label: comp.label,
            sublabel: comp.sublabel,
            handleOverrides,
          },
          style: {
            opacity: isExtended ? 1 : 0,
            transition: 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: (isExtended ? 'auto' : 'none') as React.CSSProperties['pointerEvents'],
          },
          draggable: false,
          selectable: false,
        });
      });
    }

    // --- Compute contour-following handle positions for shield ---

    // Top handles: single pair for metrics cluster at crown tip
    const topHandles: HandleSpec[] = [];
    {
      const svgX = METRICS_HANDLE_SVG_X;
      const svgY = shieldCrownY(svgX);
      const px = svgX * SCALE;
      const py = svgY * SCALE;
      topHandles.push({
        id: 'metrics-in',
        type: 'target',
        position: Position.Top,
        x: px,
        y: py,
      });
      topHandles.push({
        id: 'metrics-out',
        type: 'source',
        position: Position.Top,
        x: px + 4,
        y: py,
      });
    }

    // Bottom handles: paired source+target per broker following the bottom parabola
    const bottomHandles: HandleSpec[] = [];
    for (let i = 0; i < totalVisibleCards; i++) {
      const svgX = totalVisibleCards === 1 ? 100 : 75 + i * 50 / (totalVisibleCards - 1);
      const svgY = shieldBottomCurveY(svgX);
      const px = svgX * SCALE;
      const py = svgY * SCALE;
      bottomHandles.push({
        id: `bottom-broker-out-${i}`,
        type: 'source',
        position: Position.Bottom,
        x: px - 1,
        y: py,
      });
      bottomHandles.push({
        id: `bottom-broker-in-${i}`,
        type: 'target',
        position: Position.Bottom,
        x: px + 1,
        y: py,
      });
    }

    // Left handles: on left wing edge
    const leftHandles: HandleSpec[] = [];
    LEFT_AUX_COMPONENTS.forEach((_, i) => {
      const px = LEFT_WING_SVG_X * SCALE;
      const py = AUX_SVG_Y[i] * SCALE;
      leftHandles.push({
        id: `left-aux-in-${i}`,
        type: 'target',
        position: Position.Left,
        x: px,
        y: py,
      });
      leftHandles.push({
        id: `left-aux-out-${i}`,
        type: 'source',
        position: Position.Left,
        x: px,
        y: py + 4,
      });
    });

    // Right handles: on right wing edge
    const rightHandles: HandleSpec[] = [];
    RIGHT_AUX_COMPONENTS.forEach((_, i) => {
      const px = RIGHT_WING_SVG_X * SCALE;
      const py = AUX_SVG_Y[i] * SCALE;
      rightHandles.push({
        id: `right-aux-in-${i}`,
        type: 'target',
        position: Position.Right,
        x: px,
        y: py,
      });
      rightHandles.push({
        id: `right-aux-out-${i}`,
        type: 'source',
        position: Position.Right,
        x: px,
        y: py + 4,
      });
    });

    // --- AgenShield (shield logo hub) ---
    result.push({
      id: 'agenshield',
      type: 'canvas-agenshield',
      position: { x: shieldX, y: shieldTopY },
      width: SHIELD_W,
      height: SHIELD_H,
      data: {
        width: SHIELD_W,
        height: SHIELD_H,
        status,
        daemonRunning: data.daemonRunning,
        shieldedCount,
        totalCount: totalVisibleCards,
        updateAvailable: false,
        topHandles,
        bottomHandles,
        leftHandles,
        rightHandles,
      },
      draggable: false,
      selectable: false,
      zIndex: data.daemonRunning ? 10 : 0,
    });

    // --- Broker-wrapped cards: single row (main cards first, then stopped-shielded) ---
    const brokerStartY = shieldTopY + SHIELD_H + BROKER_GAP;
    const allBrokerCards = [...data.cards, ...data.stoppedShieldedCards];
    if (data.hasDetection && totalVisibleCards > 0) {
      const brokerRowW = totalVisibleCards * BROKER_W + (totalVisibleCards - 1) * BROKER_H_GAP;
      const brokerStartX = contentCenterX - brokerRowW / 2;

      allBrokerCards.forEach((card, i) => {
        const brokerX = brokerStartX + i * (BROKER_W + BROKER_H_GAP);
        const brokerHandleOverrides = pinAllocation?.nodeHandles.get(`broker-${card.id}`);
        const isStoppedShielded = !card.isRunning && card.status === 'shielded';

        result.push({
          id: `broker-${card.id}`,
          type: 'canvas-broker-card',
          position: { x: brokerX, y: brokerStartY },
          width: BROKER_W,
          height: BROKER_H,
          data: {
            id: card.id,
            name: card.name,
            type: card.type,
            icon: card.icon,
            status: card.status,
            isRunning: card.isRunning,
            ...(card.agentUsername ? { agentUsername: card.agentUsername } : {}),
            ...(isStoppedShielded ? { dimmed: true } : {}),
            ...(brokerHandleOverrides ? { handleOverrides: brokerHandleOverrides } : {}),
          },
          /* Stopped-shielded brokers stay at full opacity for better visibility */
          draggable: false,
          selectable: false,
        });
      });
    }

    // --- Hidden chip node (below broker row, when cards are dismissed) ---
    if (data.dismissedCardIds.length > 0) {
      const chipY = brokerStartY + (totalVisibleCards > 0 ? BROKER_H + 30 : 0);

      result.push({
        id: 'hidden-chip',
        type: 'canvas-hidden-chip',
        position: { x: contentCenterX - 60, y: chipY },
        width: 120,
        height: 28,
        data: {
          count: data.dismissedCardIds.length,
          dismissedIds: data.dismissedCardIds,
          dismissedNames: data.dismissedNames,
        },
        draggable: false,
        selectable: false,
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
      stoppedIds: string[];
      dismissedCount: number;
      hasDetection: boolean;
      anyShielded: boolean;
      anyUnshielded: boolean;
      isExtended: boolean;
    };

    const getAllocatedHandles = (edgeId: string) =>
      pinAllocation?.edgeHandles.get(edgeId);

    // Read health directly from systemStoreSnap (decoupled from topologyKey)
    const getComponentHealth = (id: string): ComponentHealth =>
      systemStoreSnap.components[id as keyof typeof systemStoreSnap.components]?.health ?? 'ok';

    // --- Green shield connections ---
    if (topo.anyShielded || topo.isExtended) {
      // Metrics cluster ↔ shield top
      {
        const downId = 'e-metrics-shield-down';
        const upId = 'e-metrics-shield-up';
        const downHandles = getAllocatedHandles(downId);
        const upHandles = getAllocatedHandles(upId);

        result.push({
          id: downId,
          source: 'metrics-cluster',
          target: 'agenshield',
          sourceHandle: downHandles?.sourceHandle ?? 'bottom-out',
          targetHandle: downHandles?.targetHandle ?? 'metrics-in',
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true, eventDriven: true, timerDriven: false },
        });

        result.push({
          id: upId,
          source: 'agenshield',
          target: 'metrics-cluster',
          sourceHandle: upHandles?.sourceHandle ?? 'metrics-out',
          targetHandle: upHandles?.targetHandle ?? 'top-in',
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true, eventDriven: true, timerDriven: false },
        });
      }

      // Left aux ↔ shield left (with health-based wire colors)
      LEFT_AUX_COMPONENTS.forEach((comp, i) => {
        const leftId = `e-aux-shield-${comp.id}-left`;
        const rightId = `e-aux-shield-${comp.id}-right`;
        const leftHandles = getAllocatedHandles(leftId);
        const rightHandles = getAllocatedHandles(rightId);
        const health = getComponentHealth(comp.id);
        const colors = HEALTH_EDGE_COLORS[health];

        result.push({
          id: leftId,
          source: `comp-${comp.id}`,
          target: 'agenshield',
          sourceHandle: leftHandles?.sourceHandle ?? 'right',
          targetHandle: leftHandles?.targetHandle ?? `left-aux-in-${i}`,
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true, colorOverride: colors.stroke, electricColorOverride: colors.electric, eventDriven: true, timerDriven: false },
        });

        result.push({
          id: rightId,
          source: 'agenshield',
          target: `comp-${comp.id}`,
          sourceHandle: rightHandles?.sourceHandle ?? `left-aux-out-${i}`,
          targetHandle: rightHandles?.targetHandle ?? 'right',
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true, colorOverride: colors.stroke, electricColorOverride: colors.electric, eventDriven: true, timerDriven: false },
        });
      });

      // Right aux ↔ shield right (with health-based wire colors)
      RIGHT_AUX_COMPONENTS.forEach((comp, i) => {
        const leftId = `e-aux-shield-${comp.id}-left`;
        const rightId = `e-aux-shield-${comp.id}-right`;
        const leftHandles = getAllocatedHandles(leftId);
        const rightHandles = getAllocatedHandles(rightId);
        const health = getComponentHealth(comp.id);
        const colors = HEALTH_EDGE_COLORS[health];

        result.push({
          id: leftId,
          source: `comp-${comp.id}`,
          target: 'agenshield',
          sourceHandle: leftHandles?.sourceHandle ?? 'left',
          targetHandle: leftHandles?.targetHandle ?? `right-aux-in-${i}`,
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true, colorOverride: colors.stroke, electricColorOverride: colors.electric, eventDriven: true, timerDriven: false },
        });

        result.push({
          id: rightId,
          source: 'agenshield',
          target: `comp-${comp.id}`,
          sourceHandle: rightHandles?.sourceHandle ?? `right-aux-out-${i}`,
          targetHandle: rightHandles?.targetHandle ?? 'left',
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true, colorOverride: colors.stroke, electricColorOverride: colors.electric, eventDriven: true, timerDriven: false },
        });
      });
    }

    // --- AgenShield -> Main-row Brokers (traffic/danger wires) ---
    if (topo.hasDetection) {
      topo.cardIds.forEach((cardId, i) => {
        const statusEntry = topo.cardStatuses.find((s) => s.startsWith(`${cardId}:`));
        const cardStatus = statusEntry?.split(':')[1] ?? 'unshielded';

        // Handle IDs for this broker on the shield
        const shieldHandleOut = `bottom-broker-out-${i}`;
        const shieldHandleIn = `bottom-broker-in-${i}`;

        if (cardStatus === 'shielded') {
          // Shielded: paired in/out green shield wires (event-driven)
          result.push({
            id: `e-shield-broker-in-${cardId}`,
            source: 'agenshield',
            target: `broker-${cardId}`,
            sourceHandle: shieldHandleOut,
            targetHandle: 'top-bus',
            type: 'canvas-danger',
            data: { variant: 'shield', fanout: true, balanced: true, eventDriven: true, timerDriven: false },
          });
          result.push({
            id: `e-shield-broker-out-${cardId}`,
            source: `broker-${cardId}`,
            target: 'agenshield',
            sourceHandle: 'top-bus-out',
            targetHandle: shieldHandleIn,
            type: 'canvas-danger',
            data: { variant: 'shield', fanout: true, balanced: true, eventDriven: true, timerDriven: false },
          });
        } else if (cardStatus === 'shielding') {
          // Shielding: paired orange wires with timer-driven shots
          result.push({
            id: `e-shield-broker-in-${cardId}`,
            source: 'agenshield',
            target: `broker-${cardId}`,
            sourceHandle: shieldHandleOut,
            targetHandle: 'top-bus',
            type: 'canvas-danger',
            data: { variant: 'shielding', fanout: true, balanced: true },
          });
          result.push({
            id: `e-shield-broker-out-${cardId}`,
            source: `broker-${cardId}`,
            target: 'agenshield',
            sourceHandle: 'top-bus-out',
            targetHandle: shieldHandleIn,
            type: 'canvas-danger',
            data: { variant: 'shielding', fanout: true, balanced: true },
          });
        } else {
          // Unshielded: only penetration wires to metrics cluster (no shield↔broker wires)
          const upId = `e-pen-${cardId}-metrics-up`;
          const downId = `e-pen-${cardId}-metrics-down`;
          const upHandles = getAllocatedHandles(upId);
          const downHandles = getAllocatedHandles(downId);

          result.push({
            id: upId,
            source: `broker-${cardId}`,
            target: 'metrics-cluster',
            sourceHandle: upHandles?.sourceHandle ?? 'danger-up',
            targetHandle: upHandles?.targetHandle ?? 'bottom-in',
            type: 'canvas-danger',
            data: { variant: 'penetration', fanout: true, stubTop: 25, stubBottom: 15 },
          });

          result.push({
            id: downId,
            source: 'metrics-cluster',
            target: `broker-${cardId}`,
            sourceHandle: downHandles?.sourceHandle ?? 'bottom-out',
            targetHandle: downHandles?.targetHandle ?? 'danger-up-in',
            type: 'canvas-danger',
            data: { variant: 'penetration', fanout: true, stubTop: 15, stubBottom: 25 },
          });
        }
      });

      // --- AgenShield -> Stopped-shielded Brokers (dimmed shield wires, paired) ---
      topo.stoppedIds.forEach((cardId, i) => {
        const shieldHandleIdx = topo.cardIds.length + i;
        const shieldHandleOut = `bottom-broker-out-${shieldHandleIdx}`;
        const shieldHandleIn = `bottom-broker-in-${shieldHandleIdx}`;

        result.push({
          id: `e-shield-broker-in-${cardId}`,
          source: 'agenshield',
          target: `broker-${cardId}`,
          sourceHandle: shieldHandleOut,
          targetHandle: 'top-bus',
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true, dimmed: true, eventDriven: true, timerDriven: false },
        });
        result.push({
          id: `e-shield-broker-out-${cardId}`,
          source: `broker-${cardId}`,
          target: 'agenshield',
          sourceHandle: 'top-bus-out',
          targetHandle: shieldHandleIn,
          type: 'canvas-danger',
          data: { variant: 'shield', fanout: true, balanced: true, dimmed: true, eventDriven: true, timerDriven: false },
        });
      });

      // Cross-contamination tendrils — adjacent main-row brokers only (daemon mode)
      if (!false) {
        const unshieldedBrokers: string[] = [];
        topo.cardIds.forEach((cardId) => {
          const statusEntry = topo.cardStatuses.find((s) => s.startsWith(`${cardId}:`));
          const st = statusEntry?.split(':')[1] ?? 'unshielded';
          if (st === 'unshielded') unshieldedBrokers.push(cardId);
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
    }

    return result;
  }, [topologyKey, vw, vh, pinAllocation, systemStoreSnap]);

  return { nodes, edges };
}
