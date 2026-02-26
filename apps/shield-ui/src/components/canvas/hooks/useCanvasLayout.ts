/**
 * Computes node and edge positions from canvas data and viewport dimensions.
 *
 * Layout flow (top to bottom — inverted):
 *   Computer (top) → Firewalls → AgenShield bus (center)
 *     ├── DeniedBucket (left)
 *     ├── HudIndicators (top-right corner, horizontal row with bus traces)
 *     └── Controller chips (flanking)
 *   → TargetStats → Targets (bottom)
 *   Cloud (bottom-right)
 *   SystemMetrics (right of computer)
 *   ActivityPanel is a fixed overlay (not a ReactFlow node)
 *
 * Performance: nodes and edges are split into separate memos.
 * Edges use a topology key that only changes when node structure changes,
 * preventing re-renders on SSE event count updates.
 */

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { CanvasData } from '../Canvas.types';

interface ViewportSize {
  width: number;
  height: number;
}

/* ---- Controller chip definitions ---- */

const computerControllers = [
  { id: 'ctrl-io', label: 'I/O CTRL', sublabel: 'USB · NET' },
  { id: 'ctrl-mem', label: 'MEM CTRL', sublabel: 'DDR5' },
  { id: 'ctrl-log', label: 'LOG CTRL', sublabel: 'Syslog' },
];

const coreControllers = [
  { id: 'ctrl-crypto', label: 'CRYPTO', sublabel: 'AES-256' },
  { id: 'ctrl-audit', label: 'AUDIT', sublabel: 'Event log' },
  { id: 'ctrl-policy', label: 'POLICY DB', sublabel: 'SQLite' },
];

/* ---- HUD indicator definitions ---- */

const hudTypes = ['connectivity', 'auth', 'alerts', 'throughput', 'cloud'] as const;
const hudLabels = ['SSE', 'Auth', 'Alerts', 'Events', 'Cloud'] as const;

export function useCanvasLayout(data: CanvasData, viewport: ViewportSize) {
  const { width: vw, height: vh } = viewport;

  // Topology key — only changes when node structure/positions change.
  // SSE event counts (totalEvents, warningCount) are excluded so edges
  // don't re-render on every incoming event.
  const topologyKey = useMemo(
    () =>
      JSON.stringify({
        targetIds: data.targets.map((t) => t.id).sort(),
        cloudConnected: data.cloudConnected,
        sandboxUserExists: data.sandboxUserExists,
        isIsolated: data.isIsolated,
        guardedShellInstalled: data.guardedShellInstalled,
        shielded: data.targets.map((t) => `${t.id}:${t.shielded}`),
      }),
    [
      data.targets,
      data.cloudConnected,
      data.sandboxUserExists,
      data.isIsolated,
      data.guardedShellInstalled,
    ],
  );

  // --- Nodes memo: depends on full data (HUD values change with events) ---
  const nodes = useMemo(() => {
    const result: Node[] = [];

    if (vw === 0 || vh === 0) return result;

    // --- PCB background: large node behind everything ---
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

    // --- Y positions (top to bottom — spread to fill viewport) ---
    const computerY = vh * 0.05;
    const firewallY = computerY + 160;
    const coreY = firewallY + 170;
    const statsY = coreY + 150;
    const targetY = statsY + 100;

    // --- Computer node: top center ---
    result.push({
      id: 'computer',
      type: 'canvas-computer',
      position: { x: centerX - 100, y: computerY },
      data: {
        currentUser: data.currentUser,
        securityLevel: data.securityLevel,
      },
      draggable: false,
      selectable: false,
    });

    // --- System Metrics node: right of computer ---
    const sysMetricsX = centerX - 100 + 200 + 30;
    const sysMetricsY = computerY + 5;
    result.push({
      id: 'system-metrics',
      type: 'canvas-system-metrics',
      position: { x: sysMetricsX, y: sysMetricsY },
      data: {
        cpuPercent: data.cpuPercent,
        memPercent: data.memPercent,
        eventLoopP99: data.eventLoopP99,
      },
      draggable: false,
      selectable: false,
    });

    // --- Computer controller chips (flanking below computer) ---
    const ctrlChipW = 98;
    const ctrlGap = 36;
    const ctrlComputerY = computerY + 80;
    const ctrlComputerTotalW =
      computerControllers.length * ctrlChipW +
      (computerControllers.length - 1) * ctrlGap;
    const ctrlComputerStartX = centerX - ctrlComputerTotalW / 2;

    computerControllers.forEach((ctrl, i) => {
      const cx = ctrlComputerStartX + i * (ctrlChipW + ctrlGap);
      result.push({
        id: ctrl.id,
        type: 'canvas-controller',
        position: { x: cx, y: ctrlComputerY },
        data: { label: ctrl.label, sublabel: ctrl.sublabel, active: true },
        draggable: false,
        selectable: false,
      });
    });

    // --- Firewall layer ---
    const firewallPieces = [
      { id: 'network', label: 'Network Guard', sublabel: 'Outbound filtering', active: true },
      {
        id: 'system',
        label: 'System Guard',
        sublabel: 'macOS Sandbox',
        active: data.sandboxUserExists && data.isIsolated,
      },
      {
        id: 'filesystem',
        label: 'FS Guard',
        sublabel: 'Path enforcement',
        active: data.guardedShellInstalled,
      },
    ] as const;

    const firewallCount: number = firewallPieces.length;
    const firewallNodeWidth = 160;
    const firewallGap = 24;
    const firewallSpacing = firewallNodeWidth + firewallGap;
    const firewallLayerWidth = (firewallCount - 1) * firewallSpacing;
    firewallPieces.forEach((piece, i) => {
      const fx =
        firewallCount === 1
          ? centerX - firewallNodeWidth / 2
          : centerX -
            firewallLayerWidth / 2 +
            i * firewallSpacing -
            firewallNodeWidth / 2;

      result.push({
        id: `firewall-${piece.id}`,
        type: 'canvas-firewall-piece',
        position: { x: fx, y: firewallY },
        data: {
          id: piece.id,
          label: piece.label,
          sublabel: piece.sublabel,
          active: piece.active,
        },
        draggable: false,
        selectable: false,
      });
    });

    // --- Compute anchor X positions for vertical edge alignment ---
    const targetCount = data.targets.length;
    const targetNodeWidth = 160;
    const targetGap = 40;
    const maxSpacing = targetNodeWidth + targetGap;
    const availableWidth = vw - 600;
    const targetSpacing =
      targetCount > 1
        ? Math.min(maxSpacing, availableWidth / (targetCount - 1))
        : 0;
    const layerWidth = (targetCount - 1) * targetSpacing;

    const statsEstWidth = 160;
    const statsAnchors = data.targets.map((_target, i) => {
      const tx =
        targetCount === 1
          ? centerX - 80
          : centerX - layerWidth / 2 + i * targetSpacing - 80;
      return tx - 10 + statsEstWidth / 2;
    });

    const firewallAnchors = firewallPieces.map((_piece, i) => {
      const fx =
        firewallCount === 1
          ? centerX - firewallNodeWidth / 2
          : centerX -
            firewallLayerWidth / 2 +
            i * firewallSpacing -
            firewallNodeWidth / 2;
      return fx + firewallNodeWidth / 2;
    });

    // AgenShield bus bar spans all anchors with padding
    const allAnchors = [...statsAnchors, ...firewallAnchors];
    const pgPadding = 40;
    const minAnchor = Math.min(...allAnchors);
    const maxAnchor = Math.max(...allAnchors);
    const anchorSpan = maxAnchor - minAnchor + pgPadding * 2;
    const coreWidth = Math.max(anchorSpan, 500);
    const coreX = (minAnchor + maxAnchor) / 2 - coreWidth / 2;

    // Handle positions — inverted: top handles for firewalls, bottom for stats
    const topHandlePositions = firewallAnchors.map((x) => x - coreX);
    const bottomHandlePositions = statsAnchors.map((x) => x - coreX);

    // --- AgenShield core node (center) ---
    result.push({
      id: 'core',
      type: 'canvas-core',
      position: { x: coreX, y: coreY },
      data: {
        status: data.coreStatus,
        version: data.daemonVersion,
        uptime: data.daemonUptime,
        activePolicies: data.activePolicyCount,
        targetCount: firewallCount,
        width: coreWidth,
        topHandlePositions,
        bottomHandlePositions,
      },
      draggable: false,
      selectable: false,
    });

    // --- Core controller chips (flanking below core) ---
    const ctrlCoreY = coreY + 100;
    const ctrlCoreTotalW =
      coreControllers.length * ctrlChipW +
      (coreControllers.length - 1) * ctrlGap;
    const ctrlCoreStartX = coreX + coreWidth / 2 - ctrlCoreTotalW / 2;

    coreControllers.forEach((ctrl, i) => {
      const cx = ctrlCoreStartX + i * (ctrlChipW + ctrlGap);
      result.push({
        id: ctrl.id,
        type: 'canvas-controller',
        position: { x: cx, y: ctrlCoreY },
        data: { label: ctrl.label, sublabel: ctrl.sublabel, active: true },
        draggable: false,
        selectable: false,
      });
    });

    // --- Targets in horizontal row (bottom) ---
    data.targets.forEach((target, i) => {
      const tx =
        targetCount === 1
          ? centerX - 80
          : centerX - layerWidth / 2 + i * targetSpacing - 80;

      // Target stats above each target
      result.push({
        id: `stats-${target.id}`,
        type: 'canvas-target-stats',
        position: { x: tx - 10, y: statsY },
        data: {
          targetId: target.id,
          skillCount: target.skillCount,
          policyCount: target.policyCount,
          secretCount: target.secretCount,
        },
        draggable: false,
        selectable: false,
      });

      // Target node below stats
      result.push({
        id: `target-${target.id}`,
        type: 'canvas-target',
        position: { x: tx, y: targetY },
        data: { target },
        draggable: false,
        selectable: false,
      });
    });

    // --- Cloud node: bottom-right near targets ---
    const cloudGap = 40;
    result.push({
      id: 'cloud',
      type: 'canvas-cloud',
      position: { x: coreX + coreWidth + cloudGap, y: targetY },
      data: { connected: data.cloudConnected },
      draggable: false,
      selectable: false,
    });

    // --- Denied bucket: left of core ---
    const bucketX = coreX - 180;
    result.push({
      id: 'denied-bucket',
      type: 'canvas-denied-bucket',
      position: { x: bucketX, y: coreY + 10 },
      data: {},
      draggable: false,
      selectable: false,
    });

    // --- HUD indicators: top-right corner, horizontal row ---
    const hudCornerX = vw - 420;
    const hudCornerY = 30;
    const hudHGap = 70;

    const hudStatuses: Array<'ok' | 'warning' | 'error'> = [
      data.sseConnected ? 'ok' : 'error',
      data.authLocked ? 'ok' : 'warning',
      data.warningCount > 0 ? 'warning' : 'ok',
      'ok',
      data.cloudConnected ? 'ok' : 'error',
    ];

    const hudValues: Array<string | undefined> = [
      undefined,
      undefined,
      String(data.warningCount),
      String(data.totalEvents),
      undefined,
    ];

    hudTypes.forEach((type, i) => {
      result.push({
        id: `hud-${type}`,
        type: 'canvas-hud-indicator',
        position: { x: hudCornerX + i * hudHGap, y: hudCornerY },
        data: {
          type,
          label: hudLabels[i],
          status: hudStatuses[i],
          value: hudValues[i],
        },
        draggable: false,
        selectable: false,
      });
    });

    return result;
  }, [data, vw, vh]);

  // --- Edges memo: depends on topology key only (not event counts) ---
  const edges = useMemo(() => {
    const result: Edge[] = [];

    if (vw === 0 || vh === 0) return result;

    // Parse topology to determine structure
    const topo = JSON.parse(topologyKey) as {
      targetIds: string[];
      cloudConnected: boolean;
      sandboxUserExists: boolean;
      isIsolated: boolean;
      guardedShellInstalled: boolean;
      shielded: string[];
    };

    const firewallPieces = [
      { id: 'network' },
      { id: 'system' },
      { id: 'filesystem' },
    ];
    const firewallCount = firewallPieces.length;

    // --- Edge: computer → system-metrics ---
    result.push({
      id: 'e-computer-metrics',
      source: 'computer',
      target: 'system-metrics',
      sourceHandle: 'right',
      targetHandle: 'left',
      type: 'canvas-traffic',
      style: { opacity: 0.3 },
    });

    // --- Edges: computer → controllers ---
    computerControllers.forEach((ctrl) => {
      result.push({
        id: `e-computer-${ctrl.id}`,
        source: 'computer',
        target: ctrl.id,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'canvas-traffic',
        style: { opacity: 0.2 },
      });
    });

    // --- Edges: computer → firewalls ---
    firewallPieces.forEach((piece, i) => {
      result.push({
        id: `e-computer-firewall-${piece.id}`,
        source: 'computer',
        target: `firewall-${piece.id}`,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'canvas-traffic',
        style: { opacity: 0.4 },
        data: { channelOffset: i - Math.floor(firewallCount / 2) },
      });
    });

    // --- Edges: firewalls → core ---
    firewallPieces.forEach((piece, i) => {
      result.push({
        id: `e-firewall-core-${piece.id}`,
        source: `firewall-${piece.id}`,
        target: 'core',
        sourceHandle: 'bottom',
        targetHandle: `top-${i}`,
        type: 'canvas-traffic',
        style: { opacity: 0.5 },
        data: { channelOffset: i - Math.floor(firewallCount / 2) },
      });
    });

    // --- Edges: core → controllers ---
    coreControllers.forEach((ctrl) => {
      result.push({
        id: `e-core-${ctrl.id}`,
        source: 'core',
        target: ctrl.id,
        sourceHandle: 'bottom-left',
        targetHandle: 'top',
        type: 'canvas-traffic',
        style: { opacity: 0.2 },
      });
    });

    // --- Edges: core → stats and stats → targets ---
    // Build shielded map from topology
    const shieldedMap = new Map<string, boolean>();
    for (const s of topo.shielded) {
      const [id, val] = s.split(':');
      shieldedMap.set(id, val === 'true');
    }

    topo.targetIds.forEach((targetId, i) => {
      // core → stats
      const isShielded = shieldedMap.get(targetId) ?? false;
      result.push({
        id: `e-core-stats-${targetId}`,
        source: 'core',
        target: `stats-${targetId}`,
        sourceHandle: `bottom-${i}`,
        targetHandle: 'top',
        type: isShielded ? 'canvas-traffic' : 'canvas-disconnected',
        style: { opacity: 0.4 },
      });

      // stats → target
      result.push({
        id: `e-stats-target-${targetId}`,
        source: `stats-${targetId}`,
        target: `target-${targetId}`,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'canvas-traffic',
        style: { opacity: 0.3 },
      });
    });

    // --- Cloud to core edge ---
    result.push({
      id: 'e-cloud-core',
      source: 'cloud',
      target: 'core',
      sourceHandle: 'left',
      targetHandle: 'right',
      type: topo.cloudConnected ? 'canvas-cloud' : 'canvas-disconnected',
      data: { connected: topo.cloudConnected },
    });

    // --- Denied bucket edge ---
    result.push({
      id: 'e-core-denied',
      source: 'core',
      target: 'denied-bucket',
      sourceHandle: 'bottom-left',
      targetHandle: 'right',
      type: 'canvas-denied',
    });

    // --- HUD bus trace edges: core (right side) → HUD indicators (dual RX/TX) ---
    hudTypes.forEach((type, i) => {
      result.push({
        id: `e-core-hud-${type}-rx`,
        source: 'core',
        target: `hud-${type}`,
        sourceHandle: `right-hud-${i}-rx`,
        targetHandle: 'bottom-rx',
        type: 'canvas-traffic',
        style: { opacity: 0.3 },
        data: { showViaPads: false },
      });
      result.push({
        id: `e-core-hud-${type}-tx`,
        source: 'core',
        target: `hud-${type}`,
        sourceHandle: `right-hud-${i}-tx`,
        targetHandle: 'bottom-tx',
        type: 'canvas-traffic',
        style: { opacity: 0.3 },
        data: { showViaPads: false },
      });
    });

    return result;
  }, [topologyKey, vw, vh]);

  return { nodes, edges };
}
