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

    // --- Targets in horizontal row ---
    const targetCount = data.targets.length;
    const targetNodeWidth = 160; // minWidth of TargetNode
    const targetGap = 40;
    const maxSpacing = targetNodeWidth + targetGap;
    const availableWidth = vw - 600; // leave room for activity panel + margins
    const targetSpacing = targetCount > 1
      ? Math.min(maxSpacing, availableWidth / (targetCount - 1))
      : 0;
    const layerWidth = (targetCount - 1) * targetSpacing;
    const targetY = centerY + 120;

    data.targets.forEach((target, i) => {
      const tx = targetCount === 1
        ? centerX - 80
        : centerX - layerWidth / 2 + i * targetSpacing - 80;

      // Target node
      nodes.push({
        id: `target-${target.id}`,
        type: 'canvas-target',
        position: { x: tx, y: targetY },
        data: { target },
        draggable: false,
        selectable: false,
      });

      // Target stats below each target
      nodes.push({
        id: `stats-${target.id}`,
        type: 'canvas-target-stats',
        position: { x: tx - 10, y: targetY + 100 },
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
    const firewallY = targetY + 360;

    // --- Policy Graph node: above firewall row ---
    const policyGraphY = firewallY - 100;
    nodes.push({
      id: 'policy-graph',
      type: 'canvas-policy-graph',
      position: { x: centerX - 250, y: policyGraphY },
      data: { activePolicies: data.activePolicyCount, targetCount },
      draggable: false,
      selectable: false,
    });

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

    const firewallCount: number = firewallPieces.length;
    firewallPieces.forEach((piece, i) => {
      // Span the same total width as the targets layer
      const fx = firewallCount === 1
        ? centerX - 70
        : centerX - layerWidth / 2 + i * (layerWidth / (firewallCount - 1)) - 70;

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

    // --- Edges: stats → Policy Graph (convergence) ---
    data.targets.forEach((target, i) => {
      edges.push({
        id: `e-stats-pg-${target.id}`,
        source: `stats-${target.id}`,
        target: 'policy-graph',
        sourceHandle: 'bottom',
        targetHandle: `top-${i}`,
        type: 'canvas-traffic',
        style: { opacity: 0.4 },
      });
    });

    // --- Edges: Policy Graph → firewall pieces (branch down) ---
    firewallPieces.forEach((piece, i) => {
      edges.push({
        id: `e-pg-firewall-${piece.id}`,
        source: 'policy-graph',
        target: `firewall-${piece.id}`,
        sourceHandle: `bottom-${i}`,
        targetHandle: 'top',
        type: 'canvas-traffic',
        style: { opacity: 0.5 },
      });
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

    // --- Denied bucket: left of Policy Graph, same Y ---
    const bucketX = centerX - 450;
    nodes.push({
      id: 'denied-bucket',
      type: 'canvas-denied-bucket',
      position: { x: bucketX, y: policyGraphY },
      data: {},
      draggable: false,
      selectable: false,
    });

    // --- Red dashed arrow: Policy Graph → Denied bucket ---
    edges.push({
      id: 'e-pg-denied',
      source: 'policy-graph',
      target: 'denied-bucket',
      sourceHandle: 'bottom-left',
      targetHandle: 'right',
      type: 'canvas-denied',
    });

    return { nodes, edges };
  }, [data, vw, vh]);
}
