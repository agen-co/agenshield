/**
 * Static security architecture graph for the Overview page.
 *
 * Renders the "secured" (green) layout from the setup wizard graph,
 * reusing the same node/edge types — no duplication.
 */

import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Card, Typography, Box } from '@mui/material';
import { styled } from '@mui/material/styles';
import { useStatus } from '../../../api/hooks';
import { nodeTypes } from '../../setup/graph/nodes';
import { edgeTypes, EdgeFilters } from '../../setup/graph/edges';
import { securedGraphGlow } from '../../../styles/setup-animations';

const GraphContainer = styled('div')({
  width: '100%',
  height: 420,
  background: '#0a0a0f',
  borderRadius: 8,
  overflow: 'hidden',
  position: 'relative',
  animation: `${securedGraphGlow} 4s ease-in-out infinite`,
  '& .react-flow__attribution': {
    display: 'none',
  },
});

// --- Static secured layout ---

function buildOverviewNodes(agentUsername?: string): Node[] {
  const cx = 20;
  const rowH = 100;
  const containerPad = 40;
  const innerPad = 16;
  const innerRowH = 80;
  const containerW = 200;
  const containerH = containerPad + innerPad + innerRowH * 3 + 56;

  const nodes: Node[] = [
    // Container
    {
      id: 'agenshield',
      type: 'container',
      position: { x: cx, y: 20 },
      data: { label: 'AgenShield', status: 'secured' },
      style: { width: containerW, height: containerH },
    },
    // Children inside container
    {
      id: 'target',
      type: 'target',
      position: { x: innerPad, y: containerPad },
      parentId: 'agenshield',
      extent: 'parent' as const,
      data: { label: 'Target App', status: 'secured' },
    },
    {
      id: 'agent-user',
      type: 'user',
      position: { x: innerPad, y: containerPad + innerRowH },
      parentId: 'agenshield',
      extent: 'parent' as const,
      data: {
        label: 'Agent User',
        username: agentUsername || 'ash_*_agent',
        status: 'secured',
      },
    },
    {
      id: 'broker-user',
      type: 'user',
      position: { x: innerPad, y: containerPad + innerRowH * 2 },
      parentId: 'agenshield',
      extent: 'parent' as const,
      data: { label: 'Broker User', username: 'ash_*_broker', status: 'secured' },
    },
    {
      id: 'workspace',
      type: 'workspace',
      position: { x: innerPad, y: containerPad + innerRowH * 3 },
      parentId: 'agenshield',
      extent: 'parent' as const,
      data: { label: 'Workspace', path: '~/workspace', status: 'secured' },
    },
  ];

  // Bash Shell — below container
  const bashY = 20 + containerH + 40;
  nodes.push({
    id: 'bash',
    type: 'shell',
    position: { x: cx + 20, y: bashY },
    data: { label: 'Bash Shell', status: 'secured' },
  });

  // Security nodes — right of container
  const secX = cx + 280;
  const secBaseY = 20;

  nodes.push(
    {
      id: 'firewall',
      type: 'firewall',
      position: { x: secX, y: secBaseY },
      data: { label: 'Firewall', sublabel: 'Network Guard', status: 'secured' },
    },
    {
      id: 'auditlog',
      type: 'auditlog',
      position: { x: secX, y: secBaseY + rowH },
      data: { label: 'Audit Log', sublabel: 'Event Trail', status: 'secured' },
    },
    {
      id: 'seatbelt',
      type: 'security',
      position: { x: secX, y: secBaseY + rowH * 2 },
      data: { label: 'Seatbelt', badge: 'macOS Sandbox', status: 'secured' },
    },
    {
      id: 'wrappers',
      type: 'security',
      position: { x: secX, y: secBaseY + rowH * 3 },
      data: { label: 'Wrappers', badge: 'Command Proxies', status: 'secured' },
    },
    {
      id: 'broker',
      type: 'broker',
      position: { x: secX, y: secBaseY + rowH * 4 },
      data: { label: 'Policy Broker', sublabel: 'Central Guard', status: 'secured' },
    },
  );

  // Attack nodes — dimmed blocked attacks
  const attackX = secX + 220;
  const attackBaseY = bashY - 80;

  nodes.push(
    {
      id: 'attack-curl',
      type: 'attack',
      position: { x: attackX, y: attackBaseY },
      data: { label: 'curl POST', command: 'env vars → hacker.io', blocked: true, dimmed: true },
    },
    {
      id: 'attack-rm',
      type: 'attack',
      position: { x: attackX, y: attackBaseY + 80 },
      data: { label: 'rm -rf /', command: 'filesystem destroy', blocked: true, dimmed: true },
    },
    {
      id: 'attack-wget',
      type: 'attack',
      position: { x: attackX, y: attackBaseY + 160 },
      data: { label: 'wget malware', command: 'malware.sh download', blocked: true, dimmed: true },
    },
  );

  return nodes;
}

function buildOverviewEdges(): Edge[] {
  return [
    // Inside container: Target → Agent → Broker → Workspace
    {
      id: 'e-target-agent',
      source: 'target',
      sourceHandle: 'bottom',
      target: 'agent-user',
      targetHandle: 'top',
      type: 'secured',
    },
    {
      id: 'e-agent-broker-user',
      source: 'agent-user',
      sourceHandle: 'bottom',
      target: 'broker-user',
      targetHandle: 'top',
      type: 'secured',
    },
    {
      id: 'e-broker-user-workspace',
      source: 'broker-user',
      sourceHandle: 'bottom',
      target: 'workspace',
      targetHandle: 'top',
      type: 'secured',
    },
    // Container → Bash
    {
      id: 'e-shield-bash',
      source: 'agenshield',
      sourceHandle: 'bottom',
      target: 'bash',
      targetHandle: 'top',
      type: 'secured',
    },
    // Container → security nodes
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
    {
      id: 'e-shield-seatbelt',
      source: 'agenshield',
      sourceHandle: 'right',
      target: 'seatbelt',
      targetHandle: 'left',
      type: 'secured',
    },
    {
      id: 'e-shield-wrappers',
      source: 'agenshield',
      sourceHandle: 'right',
      target: 'wrappers',
      targetHandle: 'left',
      type: 'secured',
    },
    {
      id: 'e-shield-broker',
      source: 'agenshield',
      sourceHandle: 'right',
      target: 'broker',
      targetHandle: 'left',
      type: 'secured',
    },
  ];
}

// --- Component ---

export function ArchitectureGraph() {
  const { data: status } = useStatus();
  const agentUsername = status?.data?.agentUsername;

  const nodes = useMemo(() => buildOverviewNodes(agentUsername), [agentUsername]);
  const edges = useMemo(() => buildOverviewEdges(), []);

  return (
    <Card>
      <Box sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
        <Typography variant="h6" fontWeight={600}>
          Security Architecture
        </Typography>
      </Box>
      <GraphContainer>
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
    </Card>
  );
}
