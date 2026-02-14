/**
 * Computes node and edge positions from canvas data and viewport dimensions.
 * Logo, HUD, and TrafficOverlay are rendered as fixed overlays (not ReactFlow nodes).
 */

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { CanvasData } from '../Canvas.types';

interface ViewportSize {
  width: number;
  height: number;
}

export function useCanvasLayout(data: CanvasData, viewport: ViewportSize) {
  const { width: vw, height: vh } = viewport;

  return useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    if (vw === 0 || vh === 0) return { nodes, edges };

    // --- Center positions ---
    const centerX = (vw - 320) / 2; // offset for activity panel
    const centerY = vh * 0.28;

    // --- Cloud node: above center ---
    nodes.push({
      id: 'cloud',
      type: 'canvas-cloud',
      position: { x: centerX - 60, y: centerY - 160 },
      data: { connected: data.cloudConnected },
      draggable: false,
      selectable: false,
    });

    // --- Shield core: center ---
    nodes.push({
      id: 'core',
      type: 'canvas-core',
      position: { x: centerX - 80, y: centerY - 40 },
      data: {
        status: data.coreStatus,
        version: data.daemonVersion,
        uptime: data.daemonUptime,
      },
      draggable: false,
      selectable: false,
    });

    // --- Cloud to core edge ---
    edges.push({
      id: 'e-cloud-core',
      source: 'cloud',
      target: 'core',
      sourceHandle: 'bottom',
      targetHandle: 'top',
      type: data.cloudConnected ? 'canvas-cloud' : 'canvas-disconnected',
      data: { connected: data.cloudConnected },
    });

    // --- Targets in semi-circle ---
    const targetCount = data.targets.length;
    const radius = Math.min(250, vw * 0.18);
    const arcStart = (27 * Math.PI) / 180;
    const arcEnd = (153 * Math.PI) / 180;

    data.targets.forEach((target, i) => {
      let angle: number;
      if (targetCount === 1) {
        angle = Math.PI / 2; // straight down
      } else {
        angle = arcStart + (arcEnd - arcStart) * (i / (targetCount - 1));
      }

      const tx = centerX + Math.cos(angle) * radius - 75;
      const ty = centerY + 60 + Math.sin(angle) * radius;

      // Target node
      nodes.push({
        id: `target-${target.id}`,
        type: 'canvas-target',
        position: { x: tx, y: ty },
        data: { target },
        draggable: false,
        selectable: false,
      });

      // Target stats below each target
      nodes.push({
        id: `stats-${target.id}`,
        type: 'canvas-target-stats',
        position: { x: tx - 10, y: ty + 100 },
        data: {
          targetId: target.id,
          skillCount: target.skillCount,
          policyCount: target.policyCount,
          secretCount: target.secretCount,
        },
        draggable: false,
        selectable: false,
      });

      // Core to target edge
      edges.push({
        id: `e-core-target-${target.id}`,
        source: 'core',
        target: `target-${target.id}`,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: target.shielded ? 'canvas-traffic' : 'canvas-disconnected',
      });

      // Target to stats edge (subtle)
      edges.push({
        id: `e-target-stats-${target.id}`,
        source: `target-${target.id}`,
        target: `stats-${target.id}`,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'canvas-traffic',
        style: { opacity: 0.3 },
      });
    });

    // --- Firewall layer: below targets ---
    const firewallY = centerY + 60 + radius + 160;
    const firewallSpacing = 200;

    const firewallPieces = [
      {
        id: 'network',
        label: 'Network Guard',
        sublabel: 'Outbound filtering',
        active: true, // always active — core daemon feature
      },
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

    firewallPieces.forEach((piece, i) => {
      const fx = centerX - firewallSpacing + i * firewallSpacing - 60;

      nodes.push({
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

    // --- Edges: targets → center firewall (System Guard) — convergence ---
    data.targets.forEach((target) => {
      edges.push({
        id: `e-stats-firewall-${target.id}`,
        source: `stats-${target.id}`,
        target: 'firewall-system',
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'canvas-traffic',
        style: { opacity: 0.4 },
      });
    });

    // --- Horizontal firewall interconnect edges ---
    edges.push({
      id: 'e-firewall-network-system',
      source: 'firewall-network',
      target: 'firewall-system',
      sourceHandle: 'right',
      targetHandle: 'left',
      type: 'canvas-traffic',
      style: { opacity: 0.25 },
    });
    edges.push({
      id: 'e-firewall-system-fs',
      source: 'firewall-system',
      target: 'firewall-filesystem',
      sourceHandle: 'right',
      targetHandle: 'left',
      type: 'canvas-traffic',
      style: { opacity: 0.25 },
    });

    // --- Computer node: bottom ---
    const computerY = firewallY + 120;
    nodes.push({
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

    // --- Edges: firewall → computer ---
    firewallPieces.forEach((piece) => {
      edges.push({
        id: `e-firewall-computer-${piece.id}`,
        source: `firewall-${piece.id}`,
        target: 'computer',
        sourceHandle: 'bottom',
        targetHandle: 'top',
        type: 'canvas-traffic',
        style: { opacity: 0.4 },
      });
    });

    // --- Denied bucket: left of firewall row ---
    const bucketX = centerX - firewallSpacing - 240;
    nodes.push({
      id: 'denied-bucket',
      type: 'canvas-denied-bucket',
      position: { x: bucketX, y: firewallY },
      data: {},
      draggable: false,
      selectable: false,
    });

    return { nodes, edges };
  }, [data, vw, vh]);
}
