/**
 * Single integration card for the marketplace grid
 */

import {
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  Chip,
  CircularProgress,
} from '@mui/material';
import { Plug, Download, Trash2 } from 'lucide-react';

export interface IntegrationCardData {
  id: string;
  name: string;
  description: string;
  category: string;
  toolsCount: number;
  connected?: boolean;
  skillInstalled?: boolean;
}

interface IntegrationCardProps {
  integration: IntegrationCardData;
  onConnect: (id: string) => void;
  onInstallSkill?: (id: string) => void;
  onRemoveSkill?: (id: string) => void;
  connecting?: boolean;
  installingSkill?: boolean;
}

export function IntegrationCard({
  integration,
  onConnect,
  onInstallSkill,
  onRemoveSkill,
  connecting,
  installingSkill,
}: IntegrationCardProps) {
  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <CardContent sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Plug size={18} style={{ flexShrink: 0 }} />
            <Typography variant="subtitle1" fontWeight={600} noWrap>
              {integration.name}
            </Typography>
          </Box>
          {integration.connected ? (
            integration.skillInstalled ? (
              <Button
                size="small"
                color="error"
                variant="outlined"
                onClick={() => onRemoveSkill?.(integration.id)}
                disabled={installingSkill}
                startIcon={<Trash2 size={14} />}
                sx={{ flexShrink: 0 }}
              >
                Remove
              </Button>
            ) : (
              <Button
                size="small"
                variant="contained"
                onClick={() => onInstallSkill?.(integration.id)}
                disabled={installingSkill}
                startIcon={installingSkill ? <CircularProgress size={14} color="inherit" /> : <Download size={14} />}
                sx={{ flexShrink: 0 }}
              >
                {installingSkill ? 'Installing...' : 'Add Skill'}
              </Button>
            )
          ) : (
            <Button
              size="small"
              variant="contained"
              onClick={() => onConnect(integration.id)}
              disabled={connecting}
              startIcon={connecting ? <CircularProgress size={14} color="inherit" /> : undefined}
              sx={{ flexShrink: 0 }}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Chip
            label={integration.category}
            size="small"
            sx={{ textTransform: 'capitalize' }}
          />
          {integration.connected && (
            <Chip label="Connected" color="success" size="small" variant="outlined" />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {integration.description}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {integration.toolsCount} tool{integration.toolsCount !== 1 ? 's' : ''} available
        </Typography>
      </CardContent>
    </Card>
  );
}
