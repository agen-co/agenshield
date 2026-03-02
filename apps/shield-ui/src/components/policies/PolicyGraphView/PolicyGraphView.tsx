/**
 * PolicyGraphView — Read-only DAG visualization of policy graph.
 *
 * Uses @xyflow/react with custom nodes/edges.
 * Wrapped in its own ReactFlowProvider (separate from Canvas's instance).
 * Pan and zoom are built into ReactFlow.
 */

import { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Box, Button, Typography } from '@mui/material';
import { ArrowLeft, GitBranch } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { usePolicyGraph, useTieredPolicies } from '../../../api/hooks';
import { buildFlowElements } from './graph-layout';
import { PolicyGraphNodeItem } from './nodes/PolicyGraphNodeItem';
import { PolicyGraphEdgeItem } from './edges/PolicyGraphEdgeItem';
import { GraphContainer, EmptyGraphBox } from './PolicyGraphView.styles';
import type { PolicyGraphViewProps } from './PolicyGraphView.types';

const nodeTypes: NodeTypes = {
  policyNode: PolicyGraphNodeItem,
};

const edgeTypes: EdgeTypes = {
  policyEdge: PolicyGraphEdgeItem,
};

function PolicyGraphViewInner({ onBack }: PolicyGraphViewProps) {
  const theme = useTheme();
  const { data: graph } = usePolicyGraph();
  const { data: tiered } = useTieredPolicies();

  const allPolicies = useMemo(() => {
    if (!tiered) return [];
    return [...(tiered.managed ?? []), ...(tiered.global ?? []), ...(tiered.target ?? [])];
  }, [tiered]);

  const { nodes, edges } = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return { nodes: [], edges: [] };
    return buildFlowElements(graph, allPolicies);
  }, [graph, allPolicies]);

  const isEmpty = nodes.length === 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button
          size="small"
          variant="text"
          startIcon={<ArrowLeft size={14} />}
          onClick={onBack}
          sx={{ textTransform: 'none', color: 'text.secondary' }}
        >
          All Policies
        </Button>
        <GitBranch size={18} color={theme.palette.text.primary} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Policy Graph</Typography>
      </Box>

      {isEmpty ? (
        <EmptyGraphBox>
          <GitBranch size={40} />
          <Typography variant="body1" color="text.secondary">
            No policy graph nodes configured
          </Typography>
          <Typography variant="body2" color="text.disabled">
            Add graph nodes to create conditional policy chains and effects.
          </Typography>
        </EmptyGraphBox>
      ) : (
        <GraphContainer>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            minZoom={0.3}
            maxZoom={2}
          >
            <Background gap={16} size={1} color={theme.palette.divider} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(node) => {
                const action = (node.data as any)?.action;
                if (action === 'allow') return '#6CB685';
                if (action === 'deny') return '#E1583E';
                return theme.palette.text.disabled;
              }}
              style={{ borderRadius: 8 }}
            />
          </ReactFlow>
        </GraphContainer>
      )}
    </Box>
  );
}

export function PolicyGraphView(props: PolicyGraphViewProps) {
  return (
    <ReactFlowProvider>
      <PolicyGraphViewInner {...props} />
    </ReactFlowProvider>
  );
}
