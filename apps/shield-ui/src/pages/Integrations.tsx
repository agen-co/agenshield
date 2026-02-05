/**
 * Integrations page - AgentLink dashboard and marketplace
 */

import { useState, useCallback } from 'react';
import { Box, Select, MenuItem } from '@mui/material';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { AgentLinkStatus } from '../components/agentlink/AgentLinkStatus';
import { ConnectedIntegrationsList, type ConnectedIntegrationData } from '../components/agentlink/ConnectedIntegrationsList';
import { IntegrationsGrid } from '../components/agentlink/IntegrationsGrid';
import type { IntegrationCardData } from '../components/agentlink/IntegrationCard';
import { useAgentLinkOAuth } from '../components/agentlink/useAgentLinkOAuth';
import {
  useAgentLinkIntegrations,
  useAgentLinkConnectedIntegrations,
  useAgentLinkLogout,
  useAgentLinkConnectIntegration,
} from '../api/hooks';

export function Integrations() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const { startAuth, loading: authLoading } = useAgentLinkOAuth();
  const logoutMutation = useAgentLinkLogout();
  const connectMutation = useAgentLinkConnectIntegration();

  const { data: integrationsData, isLoading: integrationsLoading } = useAgentLinkIntegrations(
    category !== 'all' ? category : undefined,
    search || undefined
  );

  const { data: connectedData, isLoading: connectedLoading } = useAgentLinkConnectedIntegrations();

  const intData = integrationsData?.data as Record<string, unknown> | undefined;
  const connData = connectedData?.data as Record<string, unknown> | undefined;

  const integrations = (intData?.integrations ?? []) as IntegrationCardData[];
  const connected = (connData?.integrations ?? []) as ConnectedIntegrationData[];

  // Mark integrations that are already connected
  const connectedIds = new Set(connected.map((c) => c.id));
  const enrichedIntegrations: IntegrationCardData[] = integrations.map((i) => ({
    ...i,
    connected: connectedIds.has(i.id),
  }));

  const handleConnect = useCallback((integrationId: string) => {
    connectMutation.mutate({ integration: integrationId });
  }, [connectMutation]);

  const handleLogout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Integrations"
        description="Connect third-party services securely through AgentLink."
      />

      {/* Status card */}
      <Box sx={{ mb: 3 }}>
        <AgentLinkStatus
          onConnect={startAuth}
          onLogout={handleLogout}
          connecting={authLoading}
        />
      </Box>

      {/* Connected integrations */}
      <Box sx={{ mb: 3 }}>
        <ConnectedIntegrationsList
          integrations={connected}
          loading={connectedLoading}
        />
      </Box>

      {/* Marketplace */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search integrations..."
          />
        </Box>
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          size="small"
          displayEmpty
          sx={{ minWidth: 160, height: 40 }}
        >
          <MenuItem value="all">All Categories</MenuItem>
          <MenuItem value="communication">Communication</MenuItem>
          <MenuItem value="productivity">Productivity</MenuItem>
          <MenuItem value="development">Development</MenuItem>
          <MenuItem value="storage">Storage</MenuItem>
          <MenuItem value="calendar">Calendar</MenuItem>
          <MenuItem value="crm">CRM</MenuItem>
        </Select>
      </Box>

      <IntegrationsGrid
        integrations={enrichedIntegrations}
        loading={integrationsLoading}
        onConnect={handleConnect}
      />
    </Box>
  );
}
