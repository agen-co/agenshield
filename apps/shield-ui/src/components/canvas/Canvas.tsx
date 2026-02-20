/**
 * Canvas Dashboard — full-screen ReactFlow visualization of the AgenShield system.
 *
 * Dual mode:
 * - **Daemon mode**: Full monitoring topology (firewalls, shield core, HUD, targets)
 * - **Setup mode**: Unshielded system topology (system bus, expansion cards, PSU)
 *
 * Logo is a fixed overlay. ActivityPanel is a fixed overlay (full-height right side).
 * SetupPanel is a fixed overlay (full-height left side) for setup/add-profile flows.
 * HUD indicators are individual ReactFlow nodes. Canvas is locked (no zoom, no scroll).
 * CanvasInner runs inside <ReactFlow> to access useReactFlow() for dot animations.
 *
 * Navigation: Clicking a system component node navigates to /canvas/<page>/<tab>.
 * Browser back button returns to /canvas with zoom-out animation.
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ReactFlow, useReactFlow, useOnViewportChange, type NodeTypes, type EdgeTypes, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from '@mui/material/styles';
import { useSnapshot } from 'valtio';
import { useLocation, useNavigate } from 'react-router-dom';
import { Shield, Plus } from 'lucide-react';
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
import { useSetupCanvasData } from './hooks/useSetupCanvasData';
import { useSetupCanvasLayout } from './hooks/useSetupCanvasLayout';
import { useCanvasAnimations } from './hooks/useCanvasAnimations';
import { useDotAnimations } from './hooks/useDotAnimations';
import { DotOverlay } from './overlays/DotOverlay';
import { PcbBackground } from './backgrounds/PcbBackground';
import { ActivityPanel } from './panels/ActivityPanel';
import { SetupPanel } from './panels/SetupPanel';
import { useServerMode } from '../../api/hooks';
import { setupPanelStore, openSetupPanel, closeSetupPanel } from '../../state/setup-panel';
import {
  drilldownStore,
  clearDrilldown,
  setZoomPhase,
  COMPONENT_ROUTE_MAP,
  PAGE_ZOOM_TARGETS,
} from '../../state/canvas-drilldown';
import type { SystemComponentData } from './Canvas.types';
import { DrilldownOverlay } from './overlays/DrilldownOverlay';
import { PageOverlay } from './overlays/PageOverlay';

// Node components — daemon mode
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

// Node components — setup mode
import { ApplicationCardNode } from './nodes/ApplicationCardNode';
import { SystemBusNode } from './nodes/SystemBusNode';
import { SystemBoardNode } from './nodes/SystemBoardNode';
import { PowerSupplyNode } from './nodes/PowerSupplyNode';
import { EmptySlotNode } from './nodes/EmptySlotNode';
import { BackplaneBusNode } from './nodes/BackplaneBusNode';
import { ShieldChipNode } from './nodes/ShieldChipNode';
import { SystemComponentNode } from './nodes/SystemComponentNode';
import { AgenShieldNode } from './nodes/AgenShieldNode';
import { BrokerNode } from './nodes/BrokerNode';

// Edge components
import { TrafficEdge } from './edges/TrafficEdge';
import { DisconnectedEdge } from './edges/DisconnectedEdge';
import { CloudEdge } from './edges/CloudEdge';
import { DeniedEdge } from './edges/DeniedEdge';
import { ExposedEdge, PowerEdge } from './edges/ExposedEdge';
import { DangerWireEdge } from './edges/DangerWireEdge';

const canvasNodeTypes: NodeTypes = {
  // Shared
  'canvas-pcb-background': PcbBackground,
  'canvas-computer': ComputerNode,
  'canvas-cloud': CloudNode,
  // Daemon mode
  'canvas-core': ShieldCoreNode,
  'canvas-target': TargetNode,
  'canvas-target-stats': TargetStatsNode,
  'canvas-firewall-piece': FirewallPieceNode,
  'canvas-denied-bucket': DeniedBucketNode,
  'canvas-controller': ControllerNode,
  'canvas-hud-indicator': HudIndicatorNode,
  'canvas-system-metrics': SystemMetricsNode,
  // Setup mode
  'canvas-application-card': ApplicationCardNode,
  'canvas-system-bus': SystemBusNode,
  'canvas-system-board': SystemBoardNode,
  'canvas-power-supply': PowerSupplyNode,
  'canvas-empty-slot': EmptySlotNode,
  'canvas-backplane-bus': BackplaneBusNode,
  'canvas-shield-chip': ShieldChipNode,
  'canvas-system-component': SystemComponentNode,
  'canvas-agenshield': AgenShieldNode,
  'canvas-broker-card': BrokerNode,
};

const canvasEdgeTypes: EdgeTypes = {
  // Shared / daemon mode
  'canvas-traffic': TrafficEdge,
  'canvas-disconnected': DisconnectedEdge,
  'canvas-cloud': CloudEdge,
  'canvas-denied': DeniedEdge,
  // Setup mode
  'canvas-exposed': ExposedEdge,
  'canvas-power': PowerEdge,
  'canvas-danger': DangerWireEdge,
};

/* ---- CanvasInner: runs inside <ReactFlow> for useReactFlow() access ---- */

const PCB_BACKGROUND_ID = 'pcb-background';
const OVERVIEW_PADDING = 0.08;

function CanvasInner({
  containerWidth,
  containerHeight,
  panelWidth,
  nodeCount,
}: {
  containerWidth: number;
  containerHeight: number;
  panelWidth: number;
  nodeCount: number;
}) {
  const { fitView, getNodes, setViewport: setRFViewport } = useReactFlow();
  const { activeCardId, zoomPhase } = useSnapshot(drilldownStore);
  const location = useLocation();

  // Custom "nodes ready" check — polls DOM until enough content nodes exist.
  // We also track the count so we can re-fit when more nodes appear (e.g. brokers).
  const [nodesReady, setNodesReady] = useState(false);
  const prevNodeCountRef = useRef(0);
  useEffect(() => {
    if (nodesReady) return;
    let rafId: number;
    let settleFrames = 0;
    const check = () => {
      const nodeEls = document.querySelectorAll('.react-flow__node');
      let contentCount = 0;
      nodeEls.forEach(el => {
        const id = el.getAttribute('data-id');
        if (id && id !== PCB_BACKGROUND_ID && (el as HTMLElement).offsetWidth > 0) {
          contentCount++;
        }
      });
      if (contentCount >= 2) {
        settleFrames++;
        if (settleFrames >= 3) {
          prevNodeCountRef.current = contentCount;
          setNodesReady(true);
          return;
        }
      }
      rafId = requestAnimationFrame(check);
    };
    rafId = requestAnimationFrame(check);
    return () => cancelAnimationFrame(rafId);
  }, [nodesReady]);

  // (A) Stabilize ReactFlow API via ref — fitView/getNodes/setViewport are new
  // references every render, so effects read from the ref instead of deps.
  const rfRef = useRef({ fitView, getNodes, setViewport: setRFViewport });
  rfRef.current = { fitView, getNodes, setViewport: setRFViewport };

  // Refs for transition detection and one-shot gates
  const hasInitialFitRef = useRef(false);
  const prevPageRef = useRef('');
  const prevCardIdRef = useRef<string | null>(null);
  const isAnimatingRef = useRef(false);
  const skipClampRef = useRef(false);
  const prevDimsRef = useRef({ w: 0, h: 0 });

  // Parse canvas sub-path from route
  const subPath = location.pathname.replace(/^\/canvas\/?/, '');
  const page = subPath.split('/')[0] || '';
  const zoomTarget = (location.state as Record<string, unknown>)?.zoomTarget as string | undefined;

  // (B) fitViewContent — computes bounds from getNodes() positions + explicit
  // width/height. ReactFlow's built-in fitView ignores node dimensions when
  // measured data isn't populated, so we compute the viewport transform manually.
  const fitViewContent = useCallback((opts?: Parameters<typeof fitView>[0]) => {
    const rf = rfRef.current;

    // For targeted zoom (single node drilldown), compute viewport manually
    // so the node fills/covers the entire screen before the overlay appears.
    if (opts?.nodes && opts.nodes.length > 0) {
      const targetId = opts.nodes[0].id;
      const targetNode = rf.getNodes().find(n => n.id === targetId);
      if (targetNode) {
        const w = targetNode.width ?? targetNode.measured?.width ?? 0;
        const h = targetNode.height ?? targetNode.measured?.height ?? 0;
        if (w > 0 && h > 0) {
          const cw = containerWidth;
          const ch = containerHeight;
          // Zoom so the node covers the viewport — use max (not min)
          // so the node is at least as large as the viewport in both dimensions.
          // 1.3x overshoot ensures full coverage even with slight offsets.
          const zoom = Math.max(cw / w, ch / h) * 1.3;
          const clampedZoom = Math.min(zoom, opts.maxZoom ?? 20);

          const nodeCenterX = targetNode.position.x + w / 2;
          const nodeCenterY = targetNode.position.y + h / 2;
          const tx = cw / 2 - nodeCenterX * clampedZoom;
          const ty = ch / 2 - nodeCenterY * clampedZoom;

          skipClampRef.current = true;
          rf.setViewport({ x: tx, y: ty, zoom: clampedZoom }, { duration: opts.duration });
          if (opts.duration) {
            setTimeout(() => { skipClampRef.current = false; }, (opts.duration ?? 0) + 100);
          } else {
            requestAnimationFrame(() => { skipClampRef.current = false; });
          }
          return;
        }
      }
      // Fallback if node not found or unmeasured
      skipClampRef.current = true;
      rf.fitView(opts);
      if (opts?.duration) {
        setTimeout(() => { skipClampRef.current = false; }, (opts.duration ?? 0) + 100);
      } else {
        requestAnimationFrame(() => { skipClampRef.current = false; });
      }
      return;
    }

    // Compute bounds from getNodes() — uses position + explicit width/height
    const allNodes = rf.getNodes();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let found = 0;
    for (const n of allNodes) {
      if (n.id === PCB_BACKGROUND_ID) continue;
      const w = n.width ?? n.measured?.width ?? 0;
      const h = n.height ?? n.measured?.height ?? 0;
      if (w === 0 && h === 0) continue;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
      found++;
    }

    if (found < 2) {
      // Fallback to ReactFlow fitView if nodes aren't available
      const contentNodes = allNodes
        .filter(n => n.id !== PCB_BACKGROUND_ID)
        .map(n => ({ id: n.id }));
      rf.fitView({ ...opts, nodes: contentNodes });
      return;
    }

    const boundsW = maxX - minX;
    const boundsH = maxY - minY;
    const padding = (typeof opts?.padding === 'number' ? opts.padding : 0.08);
    const maxZoom = opts?.maxZoom ?? 1.5;
    const cw = containerWidth;
    const ch = containerHeight;

    // Effective viewport after padding — visible width excludes the panel overlay
    const visibleW = cw - panelWidth;
    const effW = visibleW * (1 - padding * 2);
    const effH = ch * (1 - padding * 2);

    // Zoom to fit content
    const zoom = Math.min(maxZoom, effW / boundsW, effH / boundsH);

    // Center content in visible area (shifted right by panelWidth)
    const visibleCenterX = (panelWidth + cw) / 2;
    const visibleCenterY = ch / 2;
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;

    const tx = visibleCenterX - contentCenterX * zoom;
    const ty = visibleCenterY - contentCenterY * zoom;

    // Skip the viewport clamp until the setViewport settles
    skipClampRef.current = true;
    if (opts?.duration) {
      rf.setViewport({ x: tx, y: ty, zoom }, { duration: opts.duration });
      // Keep clamp disabled for the animation duration
      setTimeout(() => { skipClampRef.current = false; }, (opts.duration ?? 0) + 100);
    } else {
      rf.setViewport({ x: tx, y: ty, zoom });
      requestAnimationFrame(() => { skipClampRef.current = false; });
    }
  }, [containerWidth, containerHeight, panelWidth]);

  // Keep isAnimatingRef in sync with zoomPhase (E)
  useEffect(() => {
    isAnimatingRef.current = zoomPhase !== 'idle';
  }, [zoomPhase]);

  // Effect 1 — Initial fit (C): fires once after nodes are measured.
  // If a sub-page route is active on load, zoom directly to the target node.
  useEffect(() => {
    if (!nodesReady || hasInitialFitRef.current) return;
    hasInitialFitRef.current = true;
    prevDimsRef.current = { w: containerWidth, h: containerHeight };

    if (page) {
      // Deep-link: zoom straight to the target node (fill screen)
      const targetNodeId = zoomTarget ?? `comp-${PAGE_ZOOM_TARGETS[page]}`;
      setZoomPhase('zooming-in');
      fitViewContent({
        nodes: [{ id: targetNodeId }],
        maxZoom: 20,
        duration: 600,
      });
      const tid = setTimeout(() => setZoomPhase('zoomed'), 600);
      prevPageRef.current = page;
      return () => clearTimeout(tid);
    }

    fitViewContent({ padding: OVERVIEW_PADDING, maxZoom: 1.5 });
  }, [nodesReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 1b — Re-fit when node count changes (e.g. async broker cards arriving)
  useEffect(() => {
    if (!nodesReady || !hasInitialFitRef.current) return;
    if (nodeCount === prevNodeCountRef.current) return;
    prevNodeCountRef.current = nodeCount;

    // Only re-fit during overview (no sub-page or card drilldown)
    if (!page && !activeCardId) {
      // Small delay for ReactFlow to process the new nodes
      const tid = requestAnimationFrame(() => {
        fitViewContent({ padding: OVERVIEW_PADDING, maxZoom: 1.5 });
      });
      return () => cancelAnimationFrame(tid);
    }
  }, [nodesReady, nodeCount, page, activeCardId, fitViewContent]);

  // Effect 2 — Route/card transitions (D): handles zoom-in and zoom-out for
  // both page navigation and card drilldown. Uses prev-refs to detect transitions.
  useEffect(() => {
    if (!nodesReady || !hasInitialFitRef.current) return;

    // --- Page route transitions ---
    if (page && page !== prevPageRef.current) {
      // Zoom in until the target node fills the screen
      const targetNodeId = zoomTarget ?? `comp-${PAGE_ZOOM_TARGETS[page]}`;
      setZoomPhase('zooming-in');
      fitViewContent({
        nodes: [{ id: targetNodeId }],
        maxZoom: 20,
        duration: 600,
      });
      const tid = setTimeout(() => setZoomPhase('zoomed'), 600);
      prevPageRef.current = page;
      prevCardIdRef.current = activeCardId;
      return () => clearTimeout(tid);
    }

    if (!page && prevPageRef.current) {
      // Zoom out to full view
      setZoomPhase('zooming-out');
      fitViewContent({ padding: OVERVIEW_PADDING, maxZoom: 1.5, duration: 500 });
      const tid = setTimeout(() => setZoomPhase('idle'), 550);
      prevPageRef.current = '';
      prevCardIdRef.current = activeCardId;
      return () => clearTimeout(tid);
    }

    // --- Card drilldown transitions (setup mode) (F: fixed node ID) ---
    if (activeCardId && activeCardId !== prevCardIdRef.current) {
      fitViewContent({
        nodes: [{ id: `broker-${activeCardId}` }],
        duration: 600,
        maxZoom: 20,
      });
      const tid = setTimeout(() => setZoomPhase('zoomed'), 600);
      prevPageRef.current = page;
      prevCardIdRef.current = activeCardId;
      return () => clearTimeout(tid);
    }

    if (!activeCardId && prevCardIdRef.current) {
      fitViewContent({ padding: OVERVIEW_PADDING, maxZoom: 1.5, duration: 500 });
      const tid = setTimeout(() => clearDrilldown(), 550);
      prevPageRef.current = page;
      prevCardIdRef.current = activeCardId;
      return () => clearTimeout(tid);
    }

    prevPageRef.current = page;
    prevCardIdRef.current = activeCardId;
  }, [nodesReady, page, zoomTarget, activeCardId, fitViewContent]);

  // Effect 3 — External zoom-out: handles closeDrilldown() setting
  // zoomPhase to 'zooming-out' from overlay back button.
  useEffect(() => {
    if (zoomPhase === 'zooming-out' && activeCardId) {
      fitViewContent({ padding: OVERVIEW_PADDING, maxZoom: 1.5, duration: 500 });
      const tid = setTimeout(() => clearDrilldown(), 550);
      return () => clearTimeout(tid);
    }
  }, [zoomPhase, activeCardId, fitViewContent]);

  // Effect 4 — Resize re-fit: re-fits on container resize, but only
  // when in overview (no sub-page/card drilldown).
  useEffect(() => {
    if (!nodesReady || !hasInitialFitRef.current) return;
    const { w, h } = prevDimsRef.current;
    if (containerWidth === w && containerHeight === h) return;
    prevDimsRef.current = { w: containerWidth, h: containerHeight };

    if (!page && !activeCardId) {
      fitViewContent({ padding: OVERVIEW_PADDING, maxZoom: 1.5 });
    }
  }, [containerWidth, containerHeight, nodesReady, page, activeCardId, fitViewContent]);

  // (E) Viewport clamp — prevents panning too far away from content.
  // Skipped during fitView operations and zoom animations.
  useOnViewportChange({
    onChange: useCallback(({ x, y, zoom }: Viewport) => {
      if (isAnimatingRef.current || skipClampRef.current) return;

      // Allow generous panning: content can go up to half a viewport off-screen
      const padX = containerWidth * 0.5;
      const padY = containerHeight * 0.5;
      const maxX = padX;
      const maxY = padY;
      const minX = -(containerWidth * zoom - containerWidth + padX);
      const minY = -(containerHeight * zoom - containerHeight + padY);

      const cx = Math.min(maxX, Math.max(minX, x));
      const cy = Math.min(maxY, Math.max(minY, y));

      if (cx !== x || cy !== y) {
        rfRef.current.setViewport({ x: cx, y: cy, zoom });
      }
    }, [containerWidth, containerHeight]),
  });

  useCanvasAnimations();
  useDotAnimations();

  return <DotOverlay />;
}

/** Floating "Add Target" button when setup panel is closed */
function AddTargetButton({ onClick }: { onClick: () => void }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <button
      onClick={onClick}
      style={{
        position: 'absolute',
        bottom: 20,
        left: 20,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        borderRadius: 8,
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
        backgroundColor: isDark ? 'rgba(28,28,28,0.9)' : 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(8px)',
        color: theme.palette.text.primary,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "'Manrope', sans-serif",
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        pointerEvents: 'auto',
      }}
    >
      <Plus size={14} />
      Add Target
    </button>
  );
}

export function Canvas() {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const navigate = useNavigate();
  const location = useLocation();

  const serverMode = useServerMode();
  const isSetupMode = serverMode === 'setup';
  const { panelOpen, panelMode } = useSnapshot(setupPanelStore);

  // Parse canvas sub-path from route
  const canvasSubPath = location.pathname.replace(/^\/canvas\/?/, '');
  const canvasPage = canvasSubPath.split('/')[0] || null;
  const canvasTab = canvasSubPath.split('/')[1] || undefined;

  // Auto-open panel in setup mode
  useEffect(() => {
    if (isSetupMode && !panelOpen) {
      openSetupPanel('initial-setup');
    }
  }, [serverMode]);

  // Track container dimensions with debounced ResizeObserver
  const handleResize = useCallback(() => {
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      setViewport({ width: clientWidth, height: clientHeight });
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(handleResize);
    });
    observer.observe(el);
    handleResize(); // initial measurement
    return () => { observer.disconnect(); cancelAnimationFrame(rafId); };
  }, [handleResize]);

  // Data aggregation — dual mode
  const daemonData = useCanvasData();
  const setupData = useSetupCanvasData();

  // Layout computation — dual mode
  const daemonLayout = useCanvasLayout(daemonData, viewport);
  const setupLayout = useSetupCanvasLayout(setupData, viewport);

  const { nodes, edges } = isSetupMode ? setupLayout : daemonLayout;

  // Memoize types to avoid re-renders
  const nodeTypes = useMemo(() => canvasNodeTypes, []);
  const edgeTypes = useMemo(() => canvasEdgeTypes, []);


  const handleOpenPanel = useCallback(() => {
    openSetupPanel('add-profile');
  }, []);

  const handleClosePanel = useCallback(() => {
    closeSetupPanel();
  }, []);

  const { zoomPhase } = useSnapshot(drilldownStore);

  const handlePaneClick = useCallback(() => {
    if (drilldownStore.zoomPhase === 'zoomed') {
      navigate('/canvas');
    }
  }, [navigate]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: { id: string; type?: string; data?: Record<string, unknown> }) => {
    if (node.type === 'canvas-system-component') {
      const compData = node.data as unknown as SystemComponentData;
      if (compData?.componentType) {
        const route = COMPONENT_ROUTE_MAP[compData.componentType];
        if (route) {
          const tab = route.defaultTab ? `/${route.defaultTab}` : '';
          navigate(`/canvas/${route.pageId}${tab}`, {
            state: { zoomTarget: `comp-${compData.componentType}` },
          });
        }
      }
    } else if (node.type === 'canvas-agenshield') {
      navigate('/canvas/overview', {
        state: { zoomTarget: node.id },
      });
    } else if (node.type === 'canvas-broker-card') {
      navigate('/canvas/overview', {
        state: { zoomTarget: node.id },
      });
    }
  }, [navigate]);

  return (
    <CanvasContainer ref={containerRef}>
      <SvgFilters />

      {/* ReactFlow canvas */}
      {viewport.width > 0 && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnScroll
            zoomOnPinch
            zoomOnDoubleClick={false}
            minZoom={.8}
            maxZoom={zoomPhase !== 'idle' ? 20 : 1.5}
            onPaneClick={handlePaneClick}
            onNodeClick={handleNodeClick}
            proOptions={{ hideAttribution: true }}
          >
            <CanvasInner containerWidth={viewport.width} containerHeight={viewport.height} panelWidth={panelOpen ? 260 : 0} nodeCount={nodes.length} />
          </ReactFlow>
        </div>
      )}

      {/* Fixed overlay: SetupPanel — left side */}
      <SetupPanel
        open={panelOpen}
        onClose={handleClosePanel}
        mode={panelMode ?? 'add-profile'}
      />

      {/* Fixed overlay: Logo — top-left (hidden in setup mode, branding is in panel) */}
      {!isSetupMode && (
        <LogoOverlay style={panelOpen ? { left: 400 } : undefined}>
          <Shield size={22} color={theme.palette.mode === 'dark' ? pcb.trace.bright : pcb.light.silk} />
          <div>
            <LogoText>AgenShield</LogoText>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <LogoStatusChip $running={daemonData.daemonRunning}>
                {daemonData.daemonRunning ? 'Running' : 'Stopped'}
              </LogoStatusChip>
              <LogoSub>
                v{daemonData.daemonVersion}
                {daemonData.daemonPid ? ` · PID ${daemonData.daemonPid}` : ''}
              </LogoSub>
            </div>
          </div>
        </LogoOverlay>
      )}

      {/* "Add Target" button when panel is closed and in daemon mode */}
      {!panelOpen && !isSetupMode && (
        <AddTargetButton onClick={handleOpenPanel} />
      )}

      {/* Fixed overlay: Activity Panel — right side full-height (daemon mode only) */}
      {!isSetupMode && <ActivityPanel />}

      {/* Fixed overlay: Page overlay — route-driven drilldown (both modes) */}
      {(zoomPhase === 'zooming-in' || zoomPhase === 'zoomed') && canvasPage && (
        <PageOverlay page={canvasPage} tab={canvasTab} phase={zoomPhase} />
      )}

      {/* Fixed overlay: Drilldown — card detail panel (setup mode only) */}
      {isSetupMode && <DrilldownOverlay cards={setupData.cards} />}
    </CanvasContainer>
  );
}
