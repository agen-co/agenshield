/**
 * Canvas Dashboard — full-screen ReactFlow visualization of the AgenShield system.
 * Logo is a fixed overlay. ActivityPanel is a fixed overlay (full-height right side).
 * HUD indicators are individual ReactFlow nodes. Canvas is locked (no zoom, no scroll).
 * CanvasInner runs inside <ReactFlow> to access useReactFlow() for dot animations.
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ReactFlow, useReactFlow, type NodeTypes, type EdgeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from '@mui/material/styles';
import { Shield } from 'lucide-react';
import {
  CanvasContainer,
  LogoOverlay,
  LogoText,
  LogoStatusChip,
  LogoSub,
} from './Canvas.styles';
import { pcb } from './styles/pcb-tokens';
import { SvgFilters } from './filters/SvgFilters';
import { useCanvasData } from './hooks/useCanvasData';
import { useCanvasLayout } from './hooks/useCanvasLayout';
import { useCanvasAnimations } from './hooks/useCanvasAnimations';
import { useDotAnimations } from './hooks/useDotAnimations';
import { DotOverlay } from './overlays/DotOverlay';
import { PcbBackground } from './backgrounds/PcbBackground';
import { ActivityPanel } from './panels/ActivityPanel';

// Node components
import { ShieldCoreNode } from './nodes/ShieldCoreNode';
import { CloudNode } from './nodes/CloudNode';
import { TargetNode } from './nodes/TargetNode';
import { TargetStatsNode } from './nodes/TargetStatsNode';
import { FirewallPieceNode } from './nodes/FirewallPieceNode';
import { ComputerNode } from './nodes/ComputerNode';
import { DeniedBucketNode } from './nodes/DeniedBucketNode';
import { ControllerNode } from './nodes/ControllerNode';
import { HudIndicatorNode } from './nodes/HudIndicatorNode';
import { SystemMetricsNode } from './nodes/SystemMetricsNode';

// Edge components
import { TrafficEdge } from './edges/TrafficEdge';
import { DisconnectedEdge } from './edges/DisconnectedEdge';
import { CloudEdge } from './edges/CloudEdge';
import { DeniedEdge } from './edges/DeniedEdge';

const canvasNodeTypes: NodeTypes = {
  'canvas-pcb-background': PcbBackground,
  'canvas-core': ShieldCoreNode,
  'canvas-cloud': CloudNode,
  'canvas-target': TargetNode,
  'canvas-target-stats': TargetStatsNode,
  'canvas-firewall-piece': FirewallPieceNode,
  'canvas-computer': ComputerNode,
  'canvas-denied-bucket': DeniedBucketNode,
  'canvas-controller': ControllerNode,
  'canvas-hud-indicator': HudIndicatorNode,
  'canvas-system-metrics': SystemMetricsNode,
};

const canvasEdgeTypes: EdgeTypes = {
  'canvas-traffic': TrafficEdge,
  'canvas-disconnected': DisconnectedEdge,
  'canvas-cloud': CloudEdge,
  'canvas-denied': DeniedEdge,
};

/* ---- CanvasInner: runs inside <ReactFlow> for useReactFlow() access ---- */

function CanvasInner({ containerWidth, containerHeight }: { containerWidth: number; containerHeight: number }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const id = setTimeout(() => {
      fitView({ padding: 0.08, maxZoom: 1 });
    }, 50);
    return () => clearTimeout(id);
  }, [containerWidth, containerHeight, fitView]);

  useCanvasAnimations();
  useDotAnimations();

  return <DotOverlay />;
}

export function Canvas() {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // Track container dimensions with ResizeObserver
  const handleResize = useCallback(() => {
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      setViewport({ width: clientWidth, height: clientHeight });
    }
  }, []);

  useEffect(() => {
    handleResize();
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleResize]);

  // Data aggregation
  const canvasData = useCanvasData();

  // Layout computation
  const { nodes, edges } = useCanvasLayout(canvasData, viewport);

  // Memoize types to avoid re-renders
  const nodeTypes = useMemo(() => canvasNodeTypes, []);
  const edgeTypes = useMemo(() => canvasEdgeTypes, []);

  return (
    <CanvasContainer ref={containerRef}>
      <SvgFilters />

      {/* ReactFlow canvas — locked zoom/scroll */}
      {viewport.width > 0 && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnScroll
            zoomOnPinch
            zoomOnDoubleClick={false}
            preventScrolling={false}
            minZoom={0.7}
            maxZoom={4}
            fitView
            fitViewOptions={{ padding: 0.05 }}
            proOptions={{ hideAttribution: true }}
          >
            <CanvasInner containerWidth={viewport.width} containerHeight={viewport.height} />
          </ReactFlow>
        </div>
      )}

      {/* Fixed overlay: Logo — top-left */}
      <LogoOverlay>
        <Shield size={22} color={theme.palette.mode === 'dark' ? pcb.trace.bright : pcb.light.silk} />
        <div>
          <LogoText>AgenShield</LogoText>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <LogoStatusChip $running={canvasData.daemonRunning}>
              {canvasData.daemonRunning ? 'Running' : 'Stopped'}
            </LogoStatusChip>
            <LogoSub>
              v{canvasData.daemonVersion}
              {canvasData.daemonPid ? ` · PID ${canvasData.daemonPid}` : ''}
            </LogoSub>
          </div>
        </div>
      </LogoOverlay>

      {/* Fixed overlay: Activity Panel — right side full-height */}
      <ActivityPanel />
    </CanvasContainer>
  );
}
