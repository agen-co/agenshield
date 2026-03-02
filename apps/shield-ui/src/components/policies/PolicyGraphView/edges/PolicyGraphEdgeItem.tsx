/**
 * PolicyGraphEdgeItem — Custom ReactFlow edge for policy graph.
 *
 * Shows: effect label, lifetime badge.
 * Active activations shown as animated/glowing edges.
 */

import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { Box, Typography, Tooltip, Chip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { PolicyEdgeData } from '../graph-layout';

const EFFECT_COLORS: Record<string, string> = {
  activate: '#6CB685',
  deny: '#E1583E',
  inject_secret: '#6BAEF2',
  grant_network: '#6EC2C8',
  grant_fs: '#EEA45F',
  revoke: '#E1583E',
};

const EFFECT_LABELS: Record<string, string> = {
  activate: 'activate',
  deny: 'deny',
  inject_secret: 'inject',
  grant_network: 'grant net',
  grant_fs: 'grant fs',
  revoke: 'revoke',
};

export const PolicyGraphEdgeItem = memo(function PolicyGraphEdgeItem({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const theme = useTheme();
  const edgeData = data as unknown as PolicyEdgeData;
  const color = EFFECT_COLORS[edgeData.effect] ?? theme.palette.text.secondary;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const tooltipContent = [
    `Effect: ${edgeData.effect}`,
    `Lifetime: ${edgeData.lifetime}`,
    edgeData.condition ? `Condition: ${edgeData.condition}` : null,
    edgeData.secretName ? `Secret: ${edgeData.secretName}` : null,
    edgeData.grantPatterns?.length ? `Patterns: ${edgeData.grantPatterns.join(', ')}` : null,
    edgeData.active ? 'Currently active' : null,
  ].filter(Boolean).join('\n');

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: edgeData.active ? 2.5 : 1.5,
          filter: edgeData.active ? `drop-shadow(0 0 4px ${color}80)` : 'none',
        }}
      />
      <EdgeLabelRenderer>
        <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipContent}</span>} arrow>
          <Box
            sx={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              display: 'flex',
              gap: 0.5,
              alignItems: 'center',
            }}
            className="nodrag nopan"
          >
            <Chip
              label={EFFECT_LABELS[edgeData.effect] ?? edgeData.effect}
              size="small"
              sx={{
                fontSize: 9,
                height: 16,
                backgroundColor: `${color}20`,
                color,
                fontWeight: 600,
                border: `1px solid ${color}40`,
              }}
            />
            <Typography variant="caption" sx={{ fontSize: 9, color: theme.palette.text.disabled }}>
              {edgeData.lifetime}
            </Typography>
          </Box>
        </Tooltip>
      </EdgeLabelRenderer>
    </>
  );
});
