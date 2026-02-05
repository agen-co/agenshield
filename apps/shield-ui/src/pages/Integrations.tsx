/**
 * Integrations page - AgentLink dashboard and marketplace
 */

import { useState, useCallback, useEffect } from 'react';
import { Box, Select, MenuItem } from '@mui/material';
import { useSnapshot } from 'valtio';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { AgentLinkStatus } from '../components/agentlink/AgentLinkStatus';
import { AgentLinkAuthBanner } from '../components/agentlink/AgentLinkAuthBanner';
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
import { eventStore } from '../state/events';

export function Integrations() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const { startAuth, loading: authLoading, error: authError } = useAgentLinkOAuth();
  const logoutMutation = useAgentLinkLogout();
  const connectMutation = useAgentLinkConnectIntegration();

  // Watch SSE events for agentlink auth_required (e.g. agent tried to use integration)
  const [agentLinkAuthRequired, setAgentLinkAuthRequired] = useState<{ authUrl?: string; integration?: string } | null>(null);
  const { events } = useSnapshot(eventStore);
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (latest.type === 'agentlink:auth_required') {
      setAgentLinkAuthRequired(latest.data as { authUrl?: string; integration?: string });
    } else if (latest.type === 'agentlink:auth_completed') {
      setAgentLinkAuthRequired(null);
    }
  }, [events]);

  const { data: integrationsData, isLoading: integrationsLoading } = useAgentLinkIntegrations(
    category !== 'all' ? category : undefined,
    search || undefined
  );

  const { data: connectedData, isLoading: connectedLoading } = useAgentLinkConnectedIntegrations();

  const integrations = (integrationsData?.data?.integrations ?? []) as IntegrationCardData[];
  const connected = (connectedData?.data?.integrations ?? []) as ConnectedIntegrationData[];

  // Mark integrations that are already connected
  const connectedIds = new Set(connected.map((c) => c.id));
  const enrichedIntegrations: IntegrationCardData[] = integrations.map((i) => ({
    ...i,
    connected: connectedIds.has(i.id),
  }));

  const handleConnect = useCallback((integrationId: string) => {
    connectMutation.mutate({ integration: integrationId }, {
      onSuccess: (response) => {
        const data = response?.data;
        if (data?.status === 'auth_required' && data.oauthUrl) {
          window.location.href = data.oauthUrl;
        }
        // 'connected' / 'already_connected' — queries auto-invalidate
      },
    });
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

      {/* Status card + auth banner together */}
      <Box sx={{ mb: 3 }}>
        <AgentLinkStatus
          onConnect={startAuth}
          onLogout={handleLogout}
          connecting={authLoading}
          error={authError}
        />
        <AgentLinkAuthBanner
          authRequired={agentLinkAuthRequired}
          onAuthCompleted={() => setAgentLinkAuthRequired(null)}
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
