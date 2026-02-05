/**
 * Single integration card for the marketplace grid
 */

import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Box,
  Button,
  Chip,
} from '@mui/material';
import { Plug, ExternalLink } from 'lucide-react';

export interface IntegrationCardData {
  id: string;
  name: string;
  description: string;
  category: string;
  toolsCount: number;
  connected?: boolean;
}

interface IntegrationCardProps {
  integration: IntegrationCardData;
  onConnect: (id: string) => void;
}

export function IntegrationCard({ integration, onConnect }: IntegrationCardProps) {
  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <CardContent sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Plug size={18} />
            <Typography variant="subtitle1" fontWeight={600}>
              {integration.name}
            </Typography>
          </Box>
          {integration.connected && (
            <Chip label="Connected" color="success" size="small" variant="outlined" />
          )}
        </Box>
        <Chip
          label={integration.category}
          size="small"
          sx={{ mb: 1, textTransform: 'capitalize' }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {integration.description}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {integration.toolsCount} tool{integration.toolsCount !== 1 ? 's' : ''} available
        </Typography>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2 }}>
        {integration.connected ? (
          <Button size="small" variant="outlined" startIcon={<ExternalLink size={14} />} disabled>
            Connected
          </Button>
        ) : (
          <Button size="small" variant="contained" onClick={() => onConnect(integration.id)}>
            Connect
          </Button>
        )}
      </CardActions>
    </Card>
  );
}
