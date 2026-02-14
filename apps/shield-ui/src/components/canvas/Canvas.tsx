/**
 * Canvas Dashboard — full-screen ReactFlow visualization of the AgenShield system.
 * Logo, HUD indicators, traffic chart, and activity panel are fixed overlays.
 * CanvasInner runs inside <ReactFlow> to access useReactFlow() for dot animations.
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ReactFlow, Background, useReactFlow, type NodeTypes, type EdgeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { Shield, Wifi, Lock, Bell, Activity, Cloud } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { useSnapshot } from 'valtio';
import { eventStore } from '../../state/events';
import { BLOCKED_EVENT_TYPES } from '../../utils/eventDisplay';
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
import { PolicyGraphNode } from './nodes/PolicyGraphNode';

// Edge components
import { TrafficEdge } from './edges/TrafficEdge';
import { DisconnectedEdge } from './edges/DisconnectedEdge';
import { CloudEdge } from './edges/CloudEdge';
import { DeniedEdge } from './edges/DeniedEdge';

const canvasNodeTypes: NodeTypes = {
  'canvas-core': ShieldCoreNode,
  'canvas-cloud': CloudNode,
  'canvas-target': TargetNode,
  'canvas-target-stats': TargetStatsNode,
  'canvas-firewall-piece': FirewallPieceNode,
  'canvas-computer': ComputerNode,
  'canvas-denied-bucket': DeniedBucketNode,
  'canvas-policy-graph': PolicyGraphNode,
};

const canvasEdgeTypes: EdgeTypes = {
  'canvas-traffic': TrafficEdge,
  'canvas-disconnected': DisconnectedEdge,
  'canvas-cloud': CloudEdge,
  'canvas-denied': DeniedEdge,
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

/* ---- Chart constants & helpers ---- */

const CHART_BUCKETS = 30;
const CHART_FILL_RATIO = 0.75; // fill ~75% of buckets, leave right gap
const CHART_FILLED_BUCKETS = Math.round(CHART_BUCKETS * CHART_FILL_RATIO); // ~23
const CHART_INTERVAL_SEC = 60; // 1-minute buckets

function nextRandom(prev: number, min: number, max: number): number {
  const drift = (Math.random() - 0.5) * (max - min) * 0.2;
  return Math.max(min, Math.min(max, prev + drift));
}

type ChartPoint = { requests: number; blocked: number };

function generatePlaceholder(): ChartPoint[] {
  const data: ChartPoint[] = [];
  let req = 3 + Math.random() * 4;
  let blk = 1 + Math.random() * 2;
  for (let i = 0; i < CHART_BUCKETS; i++) {
    req = nextRandom(req, 1, 10);
    blk = nextRandom(blk, 0, Math.min(req, 4));
    data.push({ requests: req, blocked: blk });
  }
  return data;
}

function floorToInterval(epoch: number, intervalSec: number): number {
  const ms = intervalSec * 1000;
  return Math.floor(epoch / ms) * ms;
}

function isBlockedEvent(event: { type: string; data?: unknown }): boolean {
  if (BLOCKED_EVENT_TYPES.has(event.type)) return true;
  if (event.type === 'interceptor:event' && (event.data as Record<string, unknown>)?.type === 'denied') return true;
  return false;
}

/* ---- Blinking dot at chart live edge ---- */

function BlinkingDot(props: { cx?: number; cy?: number; index?: number; lastIndex: number; color: string }) {
  const { cx, cy, index, lastIndex, color } = props;
  if (index !== lastIndex || !cx || !cy) return null;
  return (
    <circle cx={cx} cy={cy} r={3} fill={color} stroke={color} strokeWidth={1}>
      <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />
      <animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
    </circle>
  );
}

/* ---- CanvasInner: runs inside <ReactFlow> for useReactFlow() access ---- */

function CanvasInner({ containerWidth, containerHeight }: { containerWidth: number; containerHeight: number }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const id = setTimeout(() => fitView({ padding: 0.15 }), 50);
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

  // --- Chart data (dual-series: requests + blocked) ---
  const { events: allEvents } = useSnapshot(eventStore);

  const [placeholder, setPlaceholder] = useState(generatePlaceholder);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholder((prev) => {
        const last = prev[prev.length - 1];
        const req = nextRandom(last.requests, 1, 10);
        const blk = nextRandom(last.blocked, 0, Math.min(req, 4));
        return [...prev.slice(1), { requests: req, blocked: blk }];
      });
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const chartData = useMemo((): ChartPoint[] => {
    if (allEvents.length < 3) return placeholder;

    const now = Date.now();
    const windowMs = CHART_FILLED_BUCKETS * CHART_INTERVAL_SEC * 1000;
    const threshold = now - windowMs;

    // Bucket events into intervals
    const bucketMap = new Map<number, { requests: number; blocked: number }>();
    for (const evt of allEvents) {
      const ts = typeof evt.timestamp === 'number' ? evt.timestamp : new Date(evt.timestamp).getTime();
      if (ts < threshold) continue;
      const key = floorToInterval(ts, CHART_INTERVAL_SEC);
      const bucket = bucketMap.get(key) ?? { requests: 0, blocked: 0 };
      bucket.requests++;
      if (isBlockedEvent(evt)) bucket.blocked++;
      bucketMap.set(key, bucket);
    }

    // Build ordered array for the filled portion
    const startKey = floorToInterval(threshold, CHART_INTERVAL_SEC);
    const intervalMs = CHART_INTERVAL_SEC * 1000;
    const filled: ChartPoint[] = [];
    for (let i = 0; i < CHART_FILLED_BUCKETS; i++) {
      const key = startKey + i * intervalMs;
      const bucket = bucketMap.get(key);
      filled.push({ requests: bucket?.requests ?? 0, blocked: bucket?.blocked ?? 0 });
    }

    // Append empty buckets for the right-side buffer gap
    const emptyBuckets = CHART_BUCKETS - CHART_FILLED_BUCKETS;
    for (let i = 0; i < emptyBuckets; i++) {
      filled.push({ requests: 0, blocked: 0 });
    }

    return filled;
  }, [allEvents, placeholder]);

  const greyColor = theme.palette.mode === 'dark' ? theme.palette.grey[600] : theme.palette.grey[400];
  const isEmpty = allEvents.length < 3;
  const lastDataIndex = isEmpty ? CHART_BUCKETS - 1 : CHART_FILLED_BUCKETS - 1;
  const requestsStroke = isEmpty ? greyColor : theme.palette.primary.main;
  const requestsFill = isEmpty ? `${greyColor}10` : `${theme.palette.primary.main}15`;
  const blockedStroke = isEmpty ? greyColor : theme.palette.error.main;
  const blockedFill = isEmpty ? `${greyColor}10` : `${theme.palette.error.main}15`;

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
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={true}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          preventScrolling={true}
          minZoom={0.3}
          maxZoom={1.5}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color={dotColor} gap={24} style={{ background: bgColor }} />
          <CanvasInner containerWidth={viewport.width} containerHeight={viewport.height} />
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

      {/* Fixed overlay: Traffic chart — top, dual-area background */}
      <ChartOverlay>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <Area
              type="natural"
              dataKey="requests"
              stroke={requestsStroke}
              fill={requestsFill}
              strokeWidth={1.5}
              isAnimationActive={false}
              dot={(dotProps) => <BlinkingDot key={dotProps.index} {...dotProps} lastIndex={lastDataIndex} color={requestsStroke} />}
            />
            <Area
              type="natural"
              dataKey="blocked"
              stroke={blockedStroke}
              fill={blockedFill}
              strokeWidth={1.5}
              isAnimationActive={false}
              dot={(dotProps) => <BlinkingDot key={dotProps.index} {...dotProps} lastIndex={lastDataIndex} color={blockedStroke} />}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartOverlay>

      {/* Fixed overlay: Activity panel — right side, full height */}
      <ActivityPanel />
    </CanvasContainer>
  );
}
