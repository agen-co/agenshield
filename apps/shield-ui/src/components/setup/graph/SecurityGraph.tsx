/**
 * Security architecture graph — ReactFlow container
 *
 * Evolves based on wizard phase and completed engine steps.
 * Shows the progressive build-up of security layers.
 */

import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSnapshot } from 'valtio';
import { styled } from '@mui/material/styles';
import { setupStore, type WizardStepId, type GraphPhase } from '../../../state/setup';
import { nodeTypes } from './nodes';
import { edgeTypes, EdgeFilters } from './edges';
import { securedGraphGlow } from '../../../styles/setup-animations';

const GraphContainer = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isSecured',
})<{ isSecured?: boolean }>(({ isSecured }) => ({
  width: '100%',
  height: '100%',
  background: '#0a0a0f',
  borderRadius: 0,
  overflow: 'hidden',
  position: 'relative',
  '& .react-flow__attribution': {
    display: 'none',
  },
  ...(isSecured && {
    animation: `${securedGraphGlow} 4s ease-in-out infinite`,
  }),
}));

// --- Layout helpers ---

function buildNodes(
  completedSteps: WizardStepId[],
  graphPhase: GraphPhase,
  context: Record<string, unknown> | null,
): Node[] {
  const nodes: Node[] = [];
  const presetName = (context?.presetName as string) || 'Target App';
  const presetDetection = context?.presetDetection as Record<string, unknown> | undefined;
  const version = presetDetection?.version as string | undefined;

  const isGuarded = graphPhase !== 'vulnerable';
  const cx = 20; // main chain x
  const rowH = 100; // vertical spacing between rows

  if (isGuarded) {
    // ── GUARDED LAYOUT ──
    // AgenShield container wraps: Target + Agent User + Broker User + Workspace
    // Then connects down to Bash → blocked attacks

    const containerPad = 40; // top padding for label
    const innerPad = 16;
    const innerRowH = 80;
    const containerW = 200;
    const containerH = containerPad + innerPad + innerRowH * 3 + 56; // 4 items

    const containerStatus = graphPhase === 'secured' ? 'secured' as const : 'building' as const;
    const userStatus = completedSteps.includes('create-agent-user') ? 'secured' : 'building';
    const brokerStatus = completedSteps.includes('create-broker-user') ? 'secured' : 'building';
    const wsStatus = completedSteps.includes('create-directories') ? 'secured' : 'building';

    // Container (must come first for React Flow group)
    nodes.push({
      id: 'agenshield',
      type: 'container',
      position: { x: cx, y: 20 },
      data: { label: 'AgenShield', status: containerStatus },
      style: { width: containerW, height: containerH },
    });

    // Children inside container (positions relative to parent)
    nodes.push(
      {
        id: 'target',
        type: 'target',
        position: { x: innerPad, y: containerPad },
        parentId: 'agenshield',
        extent: 'parent' as const,
        data: {
          label: presetName,
          version: version || '',
          status: graphPhase === 'secured' ? 'secured' : 'building',
        },
      },
      {
        id: 'agent-user',
        type: 'user',
        position: { x: innerPad, y: containerPad + innerRowH },
        parentId: 'agenshield',
        extent: 'parent' as const,
        data: {
          label: 'Agent User',
          username: (context?.userConfig as Record<string, unknown>)?.agentUser
            ? ((context?.userConfig as Record<string, Record<string, unknown>>)?.agentUser?.username as string)
            : 'ash_*_agent',
          status: userStatus,
        },
      },
      {
        id: 'broker-user',
        type: 'user',
        position: { x: innerPad, y: containerPad + innerRowH * 2 },
        parentId: 'agenshield',
        extent: 'parent' as const,
        data: {
          label: 'Broker User',
          username: 'ash_*_broker',
          status: brokerStatus,
        },
      },
      {
        id: 'workspace',
        type: 'workspace',
        position: { x: innerPad, y: containerPad + innerRowH * 3 },
        parentId: 'agenshield',
        extent: 'parent' as const,
        data: {
          label: 'Workspace',
          path: '~/workspace',
          status: wsStatus,
        },
      },
    );

    // Bash Shell — below the container
    const bashY = 20 + containerH + 40;
    nodes.push({
      id: 'bash',
      type: 'shell',
      position: { x: cx + 20, y: bashY },
      data: {
        label: 'Bash Shell',
        status: graphPhase === 'secured' ? 'secured' : 'building',
      },
    });

    // Security nodes — green items to the right of the container
    const secX = cx + 280;
    const secBaseY = 20;

    // Attacks — always blocked in guarded mode, separate column to the right
    const isSecured = graphPhase === 'secured';
    const attackX = secX + 220;
    const attackBaseY = bashY - 80;

    // Firewall — always shown in guarded mode
    nodes.push({
      id: 'firewall',
      type: 'firewall',
      position: { x: secX, y: secBaseY },
      data: { label: 'Firewall', sublabel: 'Network Guard', status: 'secured' },
    });

    // Audit Log
    nodes.push({
      id: 'auditlog',
      type: 'auditlog',
      position: { x: secX, y: secBaseY + rowH },
      data: { label: 'Audit Log', sublabel: 'Event Trail', status: 'secured' },
    });

    // Phase 3: Security layers that appear during execution
    if (completedSteps.includes('generate-seatbelt') || completedSteps.includes('install-wrappers')) {
      nodes.push({
        id: 'seatbelt',
        type: 'security',
        position: { x: secX, y: secBaseY + rowH * 2 },
        data: {
          label: 'Seatbelt',
          badge: 'macOS Sandbox',
          status: completedSteps.includes('generate-seatbelt') ? 'secured' : 'building',
        },
      });
    }

    if (completedSteps.includes('install-wrappers')) {
      nodes.push({
        id: 'wrappers',
        type: 'security',
        position: { x: secX, y: secBaseY + rowH * 3 },
        data: { label: 'Wrappers', badge: 'Command Proxies', status: 'secured' },
      });
    }

    if (completedSteps.includes('install-broker')) {
      nodes.push({
        id: 'broker',
        type: 'broker',
        position: { x: secX, y: secBaseY + rowH * 4 },
        data: {
          label: 'Policy Broker',
          sublabel: 'Central Guard',
          status: completedSteps.includes('install-policies') ? 'secured' : 'building',
        },
      });
    }

    // Attack nodes — blocked, stacked to the right of bash
    nodes.push(
      {
        id: 'attack-curl',
        type: 'attack',
        position: { x: attackX, y: attackBaseY },
        data: { label: 'curl POST', command: 'env vars → hacker.io', blocked: true, dimmed: isSecured },
      },
      {
        id: 'attack-rm',
        type: 'attack',
        position: { x: attackX, y: attackBaseY + 80 },
        data: { label: 'rm -rf /', command: 'filesystem destroy', blocked: true, dimmed: isSecured },
      },
      {
        id: 'attack-wget',
        type: 'attack',
        position: { x: attackX, y: attackBaseY + 160 },
        data: { label: 'wget malware', command: 'malware.sh download', blocked: true, dimmed: isSecured },
      },
    );

  } else {
    // ── VULNERABLE LAYOUT ──
    // Vertical centered: Target → Root Access → Bash Shell → attacks fanned below
    const vcx = 250; // center x for vulnerable layout
    const vRowH = 90; // tighter vertical spacing

    nodes.push(
      {
        id: 'target',
        type: 'target',
        position: { x: vcx, y: 30 },
        data: {
          label: presetName,
          version: version || '',
          status: 'vulnerable' as const,
        },
      },
      {
        id: 'root-access',
        type: 'access',
        position: { x: vcx, y: 30 + vRowH },
        data: { label: 'Root Access', status: 'vulnerable' as const },
      },
      {
        id: 'bash',
        type: 'shell',
        position: { x: vcx, y: 30 + vRowH * 2 },
        data: { label: 'Bash Shell', status: 'vulnerable' },
      },
    );

    // Attacks — fanned out below bash, centered on vcx
    // Attack nodes are ~230px wide, chain nodes ~170px. Offset attacks to center-align.
    const attackY = 30 + vRowH * 3 + 30; // extra gap for edge routing
    const attackSpread = 250;
    const attackOffset = -30; // shift left to center wider attack nodes under chain
    nodes.push(
      {
        id: 'attack-curl',
        type: 'attack',
        position: { x: vcx - attackSpread + attackOffset, y: attackY },
        data: { label: 'curl POST', command: 'env vars → hacker.io', blocked: false },
      },
      {
        id: 'attack-rm',
        type: 'attack',
        position: { x: vcx + attackOffset, y: attackY },
        data: { label: 'rm -rf /', command: 'filesystem destroy', blocked: false },
      },
      {
        id: 'attack-wget',
        type: 'attack',
        position: { x: vcx + attackSpread + attackOffset, y: attackY },
        data: { label: 'wget malware', command: 'malware.sh download', blocked: false },
      },
    );
  }

  return nodes;
}

function buildEdges(
  completedSteps: WizardStepId[],
  graphPhase: GraphPhase,
): Edge[] {
  const edges: Edge[] = [];
  const isGuarded = graphPhase !== 'vulnerable';

  if (isGuarded) {
    // ── GUARDED EDGES ──

    // Inside the container: Target → Agent → Broker → Workspace
    edges.push(
      {
        id: 'e-target-agent',
        source: 'target',
        sourceHandle: 'bottom',
        target: 'agent-user',
        targetHandle: 'top',
        type: completedSteps.includes('create-agent-user') ? 'secured' : 'building',
      },
      {
        id: 'e-agent-broker-user',
        source: 'agent-user',
        sourceHandle: 'bottom',
        target: 'broker-user',
        targetHandle: 'top',
        type: completedSteps.includes('create-broker-user') ? 'secured' : 'building',
      },
      {
        id: 'e-broker-user-workspace',
        source: 'broker-user',
        sourceHandle: 'bottom',
        target: 'workspace',
        targetHandle: 'top',
        type: completedSteps.includes('create-directories') ? 'secured' : 'building',
      },
    );

    // Container → Bash (the sandbox lets traffic through to bash, but guarded)
    edges.push({
      id: 'e-shield-bash',
      source: 'agenshield',
      sourceHandle: 'bottom',
      target: 'bash',
      targetHandle: 'top',
      type: graphPhase === 'secured' ? 'secured' : 'building',
    });

    // Bash → Attacks (blocked, hidden when fully secured to reduce clutter)
    if (graphPhase !== 'secured') {
      edges.push(
        {
          id: 'e-bash-curl',
          source: 'bash',
          sourceHandle: 'right',
          target: 'attack-curl',
          targetHandle: 'left',
          type: 'blocked',
        },
        {
          id: 'e-bash-rm',
          source: 'bash',
          sourceHandle: 'right',
          target: 'attack-rm',
          targetHandle: 'left',
          type: 'blocked',
        },
        {
          id: 'e-bash-wget',
          source: 'bash',
          sourceHandle: 'right',
          target: 'attack-wget',
          targetHandle: 'left',
          type: 'blocked',
        },
      );
    }

    // Container → security nodes (right side)
    edges.push(
      {
        id: 'e-shield-firewall',
        source: 'agenshield',
        sourceHandle: 'right',
        target: 'firewall',
        targetHandle: 'left',
        type: 'secured',
      },
      {
        id: 'e-shield-auditlog',
        source: 'agenshield',
        sourceHandle: 'right',
        target: 'auditlog',
        targetHandle: 'left',
        type: 'secured',
      },
    );

    // Security layer edges
    if (completedSteps.includes('generate-seatbelt') || completedSteps.includes('install-wrappers')) {
      edges.push({
        id: 'e-shield-seatbelt',
        source: 'agenshield',
        sourceHandle: 'right',
        target: 'seatbelt',
        targetHandle: 'left',
        type: completedSteps.includes('generate-seatbelt') ? 'secured' : 'building',
      });
    }

    if (completedSteps.includes('install-wrappers')) {
      edges.push({
        id: 'e-shield-wrappers',
        source: 'agenshield',
        sourceHandle: 'right',
        target: 'wrappers',
        targetHandle: 'left',
        type: 'secured',
      });
    }

    if (completedSteps.includes('install-broker')) {
      edges.push({
        id: 'e-shield-broker',
        source: 'agenshield',
        sourceHandle: 'right',
        target: 'broker',
        targetHandle: 'left',
        type: 'secured',
      });
    }

  } else {
    // ── VULNERABLE EDGES ──

    // Vertical chain
    edges.push(
      {
        id: 'e-target-root',
        source: 'target',
        sourceHandle: 'bottom',
        target: 'root-access',
        targetHandle: 'top',
        type: 'vulnerable',
        data: { delay: 0 },
      },
      {
        id: 'e-root-bash',
        source: 'root-access',
        sourceHandle: 'bottom',
        target: 'bash',
        targetHandle: 'top',
        type: 'vulnerable',
        data: { delay: 0.7 },
      },
    );

    // Bash → Attacks (straight fan from bottom to attack tops)
    edges.push(
      {
        id: 'e-bash-curl',
        source: 'bash',
        sourceHandle: 'bottom',
        target: 'attack-curl',
        targetHandle: 'top',
        type: 'vulnerable',
        data: { delay: 1.4 },
      },
      {
        id: 'e-bash-rm',
        source: 'bash',
        sourceHandle: 'bottom',
        target: 'attack-rm',
        targetHandle: 'top',
        type: 'vulnerable',
        data: { delay: 1.6 },
      },
      {
        id: 'e-bash-wget',
        source: 'bash',
        sourceHandle: 'bottom',
        target: 'attack-wget',
        targetHandle: 'top',
        type: 'vulnerable',
        data: { delay: 1.8 },
      },
    );
  }

  return edges;
}

// --- Component ---

export function SecurityGraph() {
  const { completedEngineSteps, graphPhase, context } = useSnapshot(setupStore);

  const nodes = useMemo(
    () => buildNodes(completedEngineSteps as WizardStepId[], graphPhase, context as Record<string, unknown> | null),
    [completedEngineSteps, graphPhase, context],
  );

  const edges = useMemo(
    () => buildEdges(completedEngineSteps as WizardStepId[], graphPhase),
    [completedEngineSteps, graphPhase],
  );

  return (
    <GraphContainer isSecured={graphPhase === 'secured'}>
      <EdgeFilters />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        minZoom={0.5}
        maxZoom={1.2}
      >
        <Background color="#1a1a2e" gap={20} />
      </ReactFlow>
    </GraphContainer>
  );
}
