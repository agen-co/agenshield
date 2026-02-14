/**
 * Canvas Dashboard — full-screen ReactFlow visualization of the AgenShield system.
 * Logo, HUD indicators, traffic chart, and activity panel are fixed overlays.
 * CanvasInner runs inside <ReactFlow> to access useReactFlow() for dot animations.
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ReactFlow, Background, type NodeTypes, type EdgeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { Shield, Wifi, Lock, Bell, Activity, Cloud } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
  CanvasContainer,
  LogoOverlay,
  LogoText,
  LogoStatusChip,
  LogoSub,
  HudOverlay,
  HudItem,
  HudStatusDot,
  ChartOverlay,
} from './Canvas.styles';
import { SvgFilters } from './filters/SvgFilters';
import { useCanvasData } from './hooks/useCanvasData';
import { useCanvasLayout } from './hooks/useCanvasLayout';
import { useCanvasAnimations } from './hooks/useCanvasAnimations';
import { useDotAnimations } from './hooks/useDotAnimations';
import { DotOverlay } from './overlays/DotOverlay';
import { ActivityPanel } from './panels/ActivityPanel';

// Node components
import { ShieldCoreNode } from './nodes/ShieldCoreNode';
import { CloudNode } from './nodes/CloudNode';
import { TargetNode } from './nodes/TargetNode';
import { TargetStatsNode } from './nodes/TargetStatsNode';
import { FirewallPieceNode } from './nodes/FirewallPieceNode';
import { ComputerNode } from './nodes/ComputerNode';
import { DeniedBucketNode } from './nodes/DeniedBucketNode';

// Edge components
import { TrafficEdge } from './edges/TrafficEdge';
import { DisconnectedEdge } from './edges/DisconnectedEdge';
import { CloudEdge } from './edges/CloudEdge';

const canvasNodeTypes: NodeTypes = {
  'canvas-core': ShieldCoreNode,
  'canvas-cloud': CloudNode,
  'canvas-target': TargetNode,
  'canvas-target-stats': TargetStatsNode,
  'canvas-firewall-piece': FirewallPieceNode,
  'canvas-computer': ComputerNode,
  'canvas-denied-bucket': DeniedBucketNode,
};

const canvasEdgeTypes: EdgeTypes = {
  'canvas-traffic': TrafficEdge,
  'canvas-disconnected': DisconnectedEdge,
  'canvas-cloud': CloudEdge,
};

/* ---- HUD indicator config ---- */

const statusColorMap: Record<string, string> = {
  ok: '#6CB685',
  warning: '#EEA45F',
  error: '#E1583E',
};

function getStatusColor(status: string): string {
  return statusColorMap[status] ?? '#808080';
}

const hudIconMap: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  connectivity: Wifi,
  auth: Lock,
  alerts: Bell,
  throughput: Activity,
  cloud: Cloud,
};

/* ---- Smooth placeholder chart data ---- */

function nextRandom(prev: number, min: number, max: number): number {
  const drift = (Math.random() - 0.5) * (max - min) * 0.2;
  return Math.max(min, Math.min(max, prev + drift));
}

function generatePlaceholder(): { value: number }[] {
  const data: { value: number }[] = [];
  let v = 3 + Math.random() * 4;
  for (let i = 0; i < 40; i++) {
    v = nextRandom(v, 1, 10);
    data.push({ value: v });
  }
  return data;
}

/* ---- CanvasInner: runs inside <ReactFlow> for useReactFlow() access ---- */

function CanvasInner() {
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

  const bgColor = theme.palette.mode === 'dark' ? '#0a0a0a' : '#f4f4f4';
  const dotColor = theme.palette.mode === 'dark' ? '#1a1a1a' : '#e0e0e0';

  // --- HUD data ---
  const hudItems = useMemo(
    () => [
      { type: 'connectivity', label: 'SSE', status: canvasData.sseConnected ? 'ok' : 'error', description: 'Server-sent events connection' },
      { type: 'auth', label: 'Auth', status: canvasData.authLocked ? 'ok' : 'warning', description: 'Authentication protection' },
      { type: 'alerts', label: 'Alerts', status: canvasData.warningCount > 0 ? 'warning' : 'ok', value: String(canvasData.warningCount), description: 'Security warnings and alerts' },
      { type: 'throughput', label: 'Events', status: 'ok', value: String(canvasData.totalEvents), description: 'Total events processed' },
      { type: 'cloud', label: 'Cloud', status: canvasData.cloudConnected ? 'ok' : 'error', description: 'AgenCo cloud connection' },
    ],
    [canvasData.sseConnected, canvasData.authLocked, canvasData.warningCount, canvasData.totalEvents, canvasData.cloudConnected],
  );

  // --- Chart data ---
  const [placeholder, setPlaceholder] = useState(generatePlaceholder);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholder((prev) => {
        const last = prev[prev.length - 1];
        const v = nextRandom(last.value, 1, 10);
        return [...prev.slice(1), { value: v }];
      });
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const chartData = useMemo(() => {
    const evts = canvasData.recentEvents;
    if (evts.length < 3) return placeholder;
    const bins: { value: number }[] = [];
    const binSize = Math.max(1, Math.floor(evts.length / 40));
    for (let i = 0; i < 40; i++) {
      bins.push({ value: Math.min(10, evts.slice(i * binSize, (i + 1) * binSize).length) });
    }
    return bins;
  }, [canvasData.recentEvents, placeholder]);

  const chartFill = theme.palette.mode === 'dark'
    ? `${theme.palette.primary.main}15`
    : `${theme.palette.primary.main}10`;
  const chartStroke = theme.palette.mode === 'dark'
    ? theme.palette.grey[700]
    : theme.palette.grey[300];

  return (
    <CanvasContainer ref={containerRef}>
      <SvgFilters />

      {/* ReactFlow canvas */}
      {viewport.width > 0 && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={true}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          preventScrolling={true}
          minZoom={0.5}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background color={dotColor} gap={24} style={{ background: bgColor }} />
          <CanvasInner />
        </ReactFlow>
      )}

      {/* Fixed overlay: Logo — top-left */}
      <LogoOverlay>
        <Shield size={22} color={theme.palette.text.primary} />
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

      {/* Fixed overlay: HUD indicators — top-right (beside activity panel) */}
      <HudOverlay>
        {hudItems.map((hud) => {
          const IconComp = hudIconMap[hud.type] ?? Activity;
          const color = getStatusColor(hud.status);
          const tooltipText = `${hud.label}${hud.value ? ` (${hud.value})` : ''} — ${hud.description}`;
          return (
            <Tooltip key={hud.type} title={tooltipText} arrow placement="bottom">
              <HudItem>
                <IconComp size={14} color={color} />
                <HudStatusDot style={{ backgroundColor: color }} />
              </HudItem>
            </Tooltip>
          );
        })}
      </HudOverlay>

      {/* Fixed overlay: Traffic chart — bottom, full width */}
      <ChartOverlay>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <Area
              type="natural"
              dataKey="value"
              stroke={chartStroke}
              fill={chartFill}
              strokeWidth={1}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartOverlay>

      {/* Fixed overlay: Activity panel — right side, full height */}
      <ActivityPanel />
    </CanvasContainer>
  );
}
