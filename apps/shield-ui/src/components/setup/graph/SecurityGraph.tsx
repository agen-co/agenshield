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
  borderRadius: 12,
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

  // Phase 1: Always visible — target + root + bash + attacks
  nodes.push(
    {
      id: 'target',
      type: 'target',
      position: { x: 60, y: 40 },
      data: {
        label: presetName,
        version: version || '',
        status: graphPhase === 'secured' ? 'secured' : 'vulnerable',
      },
    },
    {
      id: 'root-access',
      type: 'access',
      position: { x: 60, y: 140 },
      data: {
        label: 'Root Access',
        status: graphPhase === 'secured' ? 'secured' : 'vulnerable',
      },
    },
    {
      id: 'bash',
      type: 'shell',
      position: { x: 60, y: 240 },
      data: {
        label: 'Bash Shell',
        status: graphPhase === 'secured' ? 'secured' : undefined,
      },
    },
  );

  // Attack vectors (right side)
  const attacksBlocked = completedSteps.includes('install-wrappers') || completedSteps.includes('install-policies');
  nodes.push(
    {
      id: 'attack-curl',
      type: 'attack',
      position: { x: 400, y: 40 },
      data: { label: 'curl POST', command: 'env vars → hacker.io', blocked: attacksBlocked },
    },
    {
      id: 'attack-rm',
      type: 'attack',
      position: { x: 400, y: 140 },
      data: { label: 'rm -rf /', command: 'filesystem destroy', blocked: attacksBlocked },
    },
    {
      id: 'attack-wget',
      type: 'attack',
      position: { x: 400, y: 240 },
      data: { label: 'wget malware', command: 'malware.sh download', blocked: attacksBlocked },
    },
  );

  // Phase 2: After configuration — user + workspace nodes
  if (graphPhase !== 'vulnerable') {
    const userStatus = completedSteps.includes('create-agent-user') ? 'secured' : 'building';
    const brokerStatus = completedSteps.includes('create-broker-user') ? 'secured' : 'building';
    const wsStatus = completedSteps.includes('create-directories') ? 'secured' : 'building';

    nodes.push(
      {
        id: 'agent-user',
        type: 'user',
        position: { x: 60, y: 350 },
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
        position: { x: 240, y: 350 },
        data: {
          label: 'Broker User',
          username: 'ash_*_broker',
          status: brokerStatus,
        },
      },
      {
        id: 'workspace',
        type: 'workspace',
        position: { x: 60, y: 460 },
        data: {
          label: 'Workspace',
          path: '~/workspace',
          status: wsStatus,
        },
      },
    );
  }

  // Phase 3: Security layers
  if (completedSteps.includes('generate-seatbelt') || completedSteps.includes('install-wrappers')) {
    nodes.push({
      id: 'seatbelt',
      type: 'security',
      position: { x: 240, y: 460 },
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
      position: { x: 400, y: 350 },
      data: {
        label: 'Wrappers',
        badge: 'Command Proxies',
        status: 'secured',
      },
    });
  }

  if (completedSteps.includes('install-broker')) {
    nodes.push({
      id: 'broker',
      type: 'broker',
      position: { x: 240, y: 240 },
      data: {
        label: 'Policy Broker',
        sublabel: 'Central Guard',
        status: completedSteps.includes('install-policies') ? 'secured' : 'building',
      },
    });
  }

  if (completedSteps.includes('setup-launchdaemon')) {
    nodes.push({
      id: 'daemon',
      type: 'daemon',
      position: { x: 240, y: 140 },
      data: {
        label: 'Daemon (root)',
        running: completedSteps.includes('verify'),
        status: completedSteps.includes('verify') ? 'secured' : 'building',
      },
    });
  }

  if (completedSteps.includes('setup-socket')) {
    nodes.push({
      id: 'socket',
      type: 'socket',
      position: { x: 400, y: 460 },
      data: {
        label: 'Unix Socket',
        path: '/var/run/agenshield',
        status: 'secured',
      },
    });
  }

  return nodes;
}

function buildEdges(
  completedSteps: WizardStepId[],
  graphPhase: GraphPhase,
): Edge[] {
  const edges: Edge[] = [];
  const attacksBlocked = completedSteps.includes('install-wrappers') || completedSteps.includes('install-policies');

  // Vulnerable connections (always present initially)
  edges.push(
    {
      id: 'e-target-root',
      source: 'target',
      target: 'root-access',
      type: graphPhase === 'secured' ? 'secured' : graphPhase === 'vulnerable' ? 'vulnerable' : 'building',
    },
    {
      id: 'e-root-bash',
      source: 'root-access',
      target: 'bash',
      type: graphPhase === 'secured' ? 'secured' : graphPhase === 'vulnerable' ? 'vulnerable' : 'building',
    },
  );

  // Attack edges
  edges.push(
    {
      id: 'e-bash-curl',
      source: 'bash',
      target: 'attack-curl',
      type: attacksBlocked ? 'blocked' : 'vulnerable',
    },
    {
      id: 'e-bash-rm',
      source: 'bash',
      target: 'attack-rm',
      type: attacksBlocked ? 'blocked' : 'vulnerable',
    },
    {
      id: 'e-bash-wget',
      source: 'bash',
      target: 'attack-wget',
      type: attacksBlocked ? 'blocked' : 'vulnerable',
    },
  );

  // Building phase edges
  if (graphPhase !== 'vulnerable') {
    const agentEdgeType = completedSteps.includes('create-agent-user') ? 'secured' : 'building';
    edges.push(
      {
        id: 'e-bash-agent',
        source: 'bash',
        target: 'agent-user',
        type: agentEdgeType,
      },
      {
        id: 'e-agent-workspace',
        source: 'agent-user',
        target: 'workspace',
        type: completedSteps.includes('create-directories') ? 'secured' : 'building',
      },
    );

    if (completedSteps.includes('create-broker-user')) {
      edges.push({
        id: 'e-root-broker-user',
        source: 'root-access',
        target: 'broker-user',
        type: 'secured',
      });
    }
  }

  // Security layer edges
  if (completedSteps.includes('install-broker')) {
    edges.push(
      { id: 'e-root-broker', source: 'root-access', target: 'broker', type: 'secured' },
      { id: 'e-broker-agent', source: 'broker', target: 'agent-user', type: 'secured' },
    );
  }

  if (completedSteps.includes('setup-launchdaemon')) {
    edges.push(
      { id: 'e-daemon-broker', source: 'daemon', target: 'broker', type: 'secured' },
    );
  }

  if (completedSteps.includes('setup-socket')) {
    edges.push(
      { id: 'e-agent-socket', source: 'agent-user', target: 'socket', type: 'secured' },
    );
  }

  if (completedSteps.includes('generate-seatbelt')) {
    edges.push(
      { id: 'e-workspace-seatbelt', source: 'workspace', target: 'seatbelt', type: 'secured' },
    );
  }

  if (completedSteps.includes('install-wrappers')) {
    edges.push(
      { id: 'e-agent-wrappers', source: 'agent-user', target: 'wrappers', type: 'secured' },
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
