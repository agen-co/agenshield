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
import { BarChart, Bar, Tooltip as RechartsTooltip } from 'recharts';
import { useSnapshot } from 'valtio';
import { eventStore } from '../../state/events';
import { getEventColor } from '../../utils/eventDisplay';
import {
  CanvasContainer,
  LogoOverlay,
  LogoText,
  LogoStatusChip,
  LogoSub,
  HudOverlay,
  HudItem,
  HudStatusDot,
  BottomBarOverlay,
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

const BAR_WIDTH = 5;
const BAR_GAP = 1;
const BAR_PITCH = BAR_WIDTH + BAR_GAP; // 6px per bar
const CHART_INTERVAL_SEC = 5; // 5-second buckets
const PLACEHOLDER_INITIAL = 8; // start with a few bars

function nextRandom(prev: number, min: number, max: number): number {
  const drift = (Math.random() - 0.5) * (max - min) * 0.2;
  return Math.max(min, Math.min(max, prev + drift));
}

type BarPoint = { log: number; alert: number; warning: number };

function generateInitialPlaceholder(): BarPoint[] {
  const data: BarPoint[] = [];
  let log = 3 + Math.random() * 4;
  let warn = 0.5 + Math.random();
  let a = 0;
  for (let i = 0; i < PLACEHOLDER_INITIAL; i++) {
    log = nextRandom(log, 1, 10);
    warn = nextRandom(warn, 0, 2);
    a = nextRandom(a, 0, 0.5);
    data.push({ log, warning: warn, alert: a });
  }
  return data;
}

function floorToInterval(epoch: number, intervalSec: number): number {
  const ms = intervalSec * 1000;
  return Math.floor(epoch / ms) * ms;
}

/* ---- Chart tooltip ---- */

function ChartTooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  const log = payload.find(p => p.dataKey === 'log')?.value ?? 0;
  const warning = payload.find(p => p.dataKey === 'warning')?.value ?? 0;
  const alert = payload.find(p => p.dataKey === 'alert')?.value ?? 0;
  const total = log + warning + alert;
  if (total === 0) return null;
  return (
    <div style={{
      background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '6px 10px',
      borderRadius: 6, fontSize: 11, fontFamily: "'Manrope', sans-serif",
      lineHeight: 1.5, pointerEvents: 'none',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{total} events</div>
      {log > 0 && <div>{log} logs</div>}
      {warning > 0 && <div style={{ color: '#EEA45F' }}>{warning} warnings</div>}
      {alert > 0 && <div style={{ color: '#E1583E' }}>{alert} alerts</div>}
    </div>
  );
}

/* ---- CanvasInner: runs inside <ReactFlow> for useReactFlow() access ---- */

/** Width consumed by the activity panel (340px) + its right margin (12px) */
const ACTIVITY_PANEL_WIDTH = 352;

function CanvasInner({ containerWidth, containerHeight }: { containerWidth: number; containerHeight: number }) {
  const { fitView, getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    const id = setTimeout(() => {
      fitView({ padding: 0.15, maxZoom: 0.85 });
      // Shift viewport left so nodes center in the visible area, not behind the panel
      const vp = getViewport();
      setViewport({
        x: vp.x - (ACTIVITY_PANEL_WIDTH / 2),
        y: vp.y,
        zoom: vp.zoom,
      });
    }, 50);
    return () => clearTimeout(id);
  }, [containerWidth, containerHeight, fitView, getViewport, setViewport]);

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

  // --- Chart data (grows from right, then slides as a continuous bar chart) ---
  const { events: allEvents } = useSnapshot(eventStore);

  // Max bars that fit the chart area (viewport minus activity panel)
  const chartAreaWidth = Math.max(1, viewport.width - 352);
  const maxBars = Math.max(1, Math.floor(chartAreaWidth / BAR_PITCH));

  // Placeholder: starts small, grows by 1 bar each tick until full, then slides
  const [placeholder, setPlaceholder] = useState(generateInitialPlaceholder);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholder((prev) => {
        const last = prev[prev.length - 1];
        const log = nextRandom(last.log, 1, 10);
        const warn = nextRandom(last.warning, 0, 2);
        const a = nextRandom(last.alert, 0, 0.5);
        const next = [...prev, { log, warning: warn, alert: a }];
        // Once full width, trim oldest from the left (sliding window)
        if (next.length > maxBars) return next.slice(next.length - maxBars);
        return next;
      });
    }, 1500);
    return () => clearInterval(id);
  }, [maxBars]);

  const chartData = useMemo((): BarPoint[] => {
    if (allEvents.length < 3) return placeholder;

    const now = Date.now();
    const windowMs = maxBars * CHART_INTERVAL_SEC * 1000;
    const threshold = now - windowMs;

    // Bucket events into intervals (3 categories: log, warning, alert)
    const bucketMap = new Map<number, BarPoint>();
    let earliestKey = Infinity;
    for (const evt of allEvents) {
      const ts = typeof evt.timestamp === 'number' ? evt.timestamp : new Date(evt.timestamp).getTime();
      if (ts < threshold) continue;
      const key = floorToInterval(ts, CHART_INTERVAL_SEC);
      if (key < earliestKey) earliestKey = key;
      const bucket = bucketMap.get(key) ?? { log: 0, alert: 0, warning: 0 };
      const color = getEventColor(evt);
      if (color === 'error') {
        bucket.alert++;
      } else if (color === 'warning') {
        bucket.warning++;
      } else {
        bucket.log++;
      }
      bucketMap.set(key, bucket);
    }

    if (!isFinite(earliestKey)) return placeholder;

    // Build from earliest event bucket to now — grows naturally, then caps at maxBars
    const nowKey = floorToInterval(now, CHART_INTERVAL_SEC);
    const intervalMs = CHART_INTERVAL_SEC * 1000;
    const totalBuckets = Math.floor((nowKey - earliestKey) / intervalMs) + 1;
    const numBuckets = Math.min(totalBuckets, maxBars);
    const startKey = nowKey - (numBuckets - 1) * intervalMs;

    const filled: BarPoint[] = [];
    for (let i = 0; i < numBuckets; i++) {
      const key = startKey + i * intervalMs;
      const bucket = bucketMap.get(key);
      filled.push({ log: bucket?.log ?? 0, warning: bucket?.warning ?? 0, alert: bucket?.alert ?? 0 });
    }

    return filled;
  }, [allEvents, placeholder, maxBars]);

  // Chart pixel width = exactly the bars (no empty space)
  const chartWidth = chartData.length * BAR_PITCH;

  const logColor = theme.palette.mode === 'dark' ? '#EDEDED' : '#171717';
  const alertColor = '#E1583E';
  const warningColor = '#EEA45F';

  return (
    <CanvasContainer ref={containerRef}>
      <SvgFilters />

      {/* ReactFlow canvas — constrained to leave space for floating activity panel */}
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
        </div>
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

      {/* Fixed overlay: Traffic bar chart — bottom, right-aligned, grows left */}
      <BottomBarOverlay>
        <BarChart width={chartWidth} height={100} data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barSize={BAR_WIDTH} barCategoryGap={BAR_GAP} barGap={0}>
          <RechartsTooltip content={<ChartTooltipContent />} cursor={false} />
          <Bar dataKey="log" stackId="traffic" fill={logColor} isAnimationActive={false} minPointSize={1} />
          <Bar dataKey="warning" stackId="traffic" fill={warningColor} isAnimationActive={false} />
          <Bar dataKey="alert" stackId="traffic" fill={alertColor} isAnimationActive={false} radius={[1, 1, 0, 0]} />
        </BarChart>
      </BottomBarOverlay>

      {/* Fixed overlay: Activity panel — right side, full height */}
      <ActivityPanel />
    </CanvasContainer>
  );
}
