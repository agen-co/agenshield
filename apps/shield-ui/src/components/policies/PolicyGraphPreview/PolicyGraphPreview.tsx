/**
 * PolicyGraphPreview — compact card showing graph summary stats.
 * Displays node count, edge count, active activation count.
 */

import { Box, Typography, Chip } from '@mui/material';
import { GitBranch, ChevronRight } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { styled } from '@mui/material/styles';
import { usePolicyGraph } from '../../../api/hooks';

const PreviewCard = styled(Box)(({ theme }) => ({
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius * 2,
  padding: theme.spacing(2, 3),
  cursor: 'pointer',
  transition: 'border-color 0.15s ease, background-color 0.15s ease',
  '&:hover': {
    borderColor: theme.palette.text.secondary,
    backgroundColor: theme.palette.action.hover,
  },
}));

interface PolicyGraphPreviewProps {
  onNavigate: () => void;
}

export function PolicyGraphPreview({ onNavigate }: PolicyGraphPreviewProps) {
  const theme = useTheme();
  const { data: graph } = usePolicyGraph();

  const nodeCount = graph?.nodes?.length ?? 0;
  const edgeCount = graph?.edges?.length ?? 0;
  const activeActivations = graph?.activations?.filter(a => !a.consumed)?.length ?? 0;

  return (
    <PreviewCard onClick={onNavigate}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <GitBranch size={18} color={theme.palette.text.secondary} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Policy Graph
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
          </Typography>
          <ChevronRight size={16} color={theme.palette.text.secondary} />
        </Box>
      </Box>
      {nodeCount > 0 ? (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip label={`${edgeCount} edges`} size="small" variant="outlined" sx={{ fontSize: 12 }} />
          {activeActivations > 0 && (
            <Chip
              label={`${activeActivations} active`}
              size="small"
              color="success"
              sx={{ fontSize: 12 }}
            />
          )}
        </Box>
      ) : (
        <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
          Conditional policy chains and effects
        </Typography>
      )}
    </PreviewCard>
  );
}
