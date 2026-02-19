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
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ReactFlow, useReactFlow, type NodeTypes, type EdgeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from '@mui/material/styles';
import { useSnapshot } from 'valtio';
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
import { drilldownStore, closeDrilldown } from '../../state/canvas-drilldown';
import { DrilldownOverlay } from './overlays/DrilldownOverlay';

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

function CanvasInner({
  containerWidth,
  containerHeight,
  onFitViewZoom,
}: {
  containerWidth: number;
  containerHeight: number;
  onFitViewZoom: (zoom: number) => void;
}) {
  const { fitView, getZoom } = useReactFlow();
  const { activeCardId } = useSnapshot(drilldownStore);
  const prevCardIdRef = useRef<string | null>(null);

  useEffect(() => {
    const id = setTimeout(async () => {
      await fitView({ padding: 0.08, maxZoom: 1 });
      onFitViewZoom(getZoom());
    }, 50);
    return () => clearTimeout(id);
  }, [containerWidth, containerHeight, fitView, getZoom, onFitViewZoom]);

  // Zoom into drilled-down card or back to full view
  useEffect(() => {
    if (activeCardId && activeCardId !== prevCardIdRef.current) {
      fitView({
        nodes: [{ id: `card-${activeCardId}` }, { id: `broker-${activeCardId}` }],
        padding: 0.3,
        duration: 400,
        maxZoom: 2,
      });
    } else if (!activeCardId && prevCardIdRef.current) {
      fitView({ padding: 0.08, maxZoom: 1, duration: 400 });
    }
    prevCardIdRef.current = activeCardId;
  }, [activeCardId, fitView]);

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
  const [dynamicMaxZoom, setDynamicMaxZoom] = useState(1);

  const handleFitViewZoom = useCallback((zoom: number) => {
    setDynamicMaxZoom(zoom);
  }, []);

  const serverMode = useServerMode();
  const isSetupMode = serverMode === 'setup';
  const { panelOpen, panelMode } = useSnapshot(setupPanelStore);

  // Auto-open panel in setup mode
  useEffect(() => {
    if (isSetupMode && !panelOpen) {
      openSetupPanel('initial-setup');
    }
  }, [serverMode]);

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

  const handlePaneClick = useCallback(() => {
    closeDrilldown();
  }, []);

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
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            panOnDrag
            zoomOnScroll
            zoomOnPinch
            zoomOnDoubleClick={false}
            minZoom={1}
            maxZoom={dynamicMaxZoom}
            fitView
            onPaneClick={handlePaneClick}
            fitViewOptions={{ padding: 0.1,interpolate:'smooth' }}
            proOptions={{ hideAttribution: true }}
          >
            <CanvasInner containerWidth={viewport.width} containerHeight={viewport.height} onFitViewZoom={handleFitViewZoom} />
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

      {/* Fixed overlay: Drilldown — card detail panel */}
      {isSetupMode && <DrilldownOverlay cards={setupData.cards} />}
    </CanvasContainer>
  );
}
