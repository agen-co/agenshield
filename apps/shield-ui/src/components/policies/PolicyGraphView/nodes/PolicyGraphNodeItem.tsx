/**
 * PolicyGraphNodeItem — Custom ReactFlow node for policy graph.
 *
 * Shows: policy name, target type icon, action badge.
 * Dormant nodes have dashed border and reduced opacity.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, Typography, Tooltip, Chip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Terminal, Globe, FolderOpen, Cpu, Zap } from 'lucide-react';
import type { PolicyNodeData } from '../graph-layout';

const TARGET_ICONS: Record<string, typeof Terminal> = {
  command: Terminal,
  url: Globe,
  filesystem: FolderOpen,
  process: Cpu,
  skill: Zap,
};

const ACTION_COLORS: Record<string, string> = {
  allow: '#6CB685',
  deny: '#E1583E',
  approval: '#EEA45F',
};

export const PolicyGraphNodeItem = memo(function PolicyGraphNodeItem({
  data,
}: NodeProps) {
  const theme = useTheme();
  const nodeData = data as unknown as PolicyNodeData;
  const Icon = TARGET_ICONS[nodeData.target] ?? Terminal;
  const actionColor = ACTION_COLORS[nodeData.action] ?? theme.palette.text.secondary;

  const tooltipContent = [
    `Target: ${nodeData.target}`,
    `Action: ${nodeData.action}`,
    nodeData.patterns.length > 0 ? `Patterns: ${nodeData.patterns.slice(0, 3).join(', ')}${nodeData.patterns.length > 3 ? '...' : ''}` : null,
    nodeData.dormant ? 'Dormant (inactive until activated)' : null,
    nodeData.activated ? 'Currently activated' : null,
  ].filter(Boolean).join('\n');

  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipContent}</span>} arrow placement="top">
      <Box
        sx={{
          width: 200,
          px: 1.5,
          py: 1,
          border: `2px solid ${nodeData.dormant && !nodeData.activated ? theme.palette.divider : actionColor}`,
          borderStyle: nodeData.dormant && !nodeData.activated ? 'dashed' : 'solid',
          borderRadius: 2,
          backgroundColor: theme.palette.background.paper,
          opacity: nodeData.dormant && !nodeData.activated ? 0.6 : 1,
          transition: 'opacity 0.2s, border-color 0.2s',
          boxShadow: nodeData.activated ? `0 0 8px ${actionColor}40` : 'none',
        }}
      >
        <Handle type="target" position={Position.Left} style={{ background: theme.palette.divider }} />
        <Handle type="source" position={Position.Right} style={{ background: theme.palette.divider }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Icon size={14} color={theme.palette.text.secondary} />
          <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
            {nodeData.policyName}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Chip
            label={nodeData.action}
            size="small"
            sx={{
              fontSize: 10,
              height: 18,
              backgroundColor: `${actionColor}20`,
              color: actionColor,
              fontWeight: 600,
            }}
          />
          {nodeData.dormant && !nodeData.activated && (
            <Chip label="dormant" size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
          )}
          {nodeData.activated && (
            <Chip label="active" size="small" color="success" sx={{ fontSize: 10, height: 18 }} />
          )}
        </Box>
      </Box>
    </Tooltip>
  );
});
