/**
 * Marketplace grid of available integrations
 */

import { Box, Grid, Skeleton, Typography } from '@mui/material';
import { Package } from 'lucide-react';
import { IntegrationCard, type IntegrationCardData } from './IntegrationCard';
import { EmptyState } from '../shared/EmptyState';

interface IntegrationsGridProps {
  integrations: IntegrationCardData[];
  loading: boolean;
  onConnect: (id: string) => void;
  connectingId?: string | null;
}

export function IntegrationsGrid({ integrations, loading, onConnect, connectingId }: IntegrationsGridProps) {
  if (loading) {
    return (
      <Grid container spacing={2}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Grid item xs={12} sm={6} md={4} key={i}>
            <Skeleton variant="rectangular" height={180} sx={{ borderRadius: 1 }} />
          </Grid>
        ))}
      </Grid>
    );
  }

  if (integrations.length === 0) {
    return (
      <EmptyState
        icon={<Package size={28} />}
        title="No integrations found"
        description="Try a different search or category filter."
      />
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
        {integrations.length} integration{integrations.length !== 1 ? 's' : ''} available
      </Typography>
      <Grid container spacing={2}>
        {integrations.map((integration) => (
          <Grid item xs={12} sm={6} md={4} key={integration.id}>
            <IntegrationCard integration={integration} onConnect={onConnect} connecting={connectingId === integration.id} />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
