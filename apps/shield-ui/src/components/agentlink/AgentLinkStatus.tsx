/**
 * AgentLink connection status card
 */

import {
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  Chip,
  Skeleton,
  Alert,
} from '@mui/material';
import { Link2, Link2Off, RefreshCw } from 'lucide-react';
import { useAgentLinkStatus, useAgentLinkMCPStatus } from '../../api/hooks';

interface AgentLinkStatusProps {
  onConnect: () => void;
  onLogout: () => void;
  connecting?: boolean;
  error?: string | null;
}

export function AgentLinkStatus({ onConnect, onLogout, connecting, error }: AgentLinkStatusProps) {
  const { data: authData, isLoading: authLoading } = useAgentLinkStatus();
  const { data: mcpData, isLoading: mcpLoading } = useAgentLinkMCPStatus();

  const auth = authData?.data;
  const mcp = mcpData?.data;
  const isLoading = authLoading || mcpLoading;

  const isAuthenticated = auth?.authenticated && !auth?.expired;
  const mcpConnected = mcp?.state === 'connected';

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {isAuthenticated ? <Link2 size={20} /> : <Link2Off size={20} />}
            <Typography variant="h6" fontWeight={600}>
              AgentLink
            </Typography>
          </Box>
          {isLoading ? (
            <Skeleton width={80} height={24} />
          ) : (
            <Chip
              label={isAuthenticated ? (mcpConnected ? 'Connected' : 'Authenticated') : 'Not Connected'}
              color={isAuthenticated ? (mcpConnected ? 'success' : 'warning') : 'default'}
              size="small"
              variant="outlined"
            />
          )}
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Skeleton variant="text" width="80%" />
            <Skeleton variant="text" width="60%" />
          </Box>
        ) : isAuthenticated ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Secure integrations gateway is active. Your API credentials are stored in the AgentLink cloud vault.
            </Typography>
            {auth?.expiresAt && (
              <Typography variant="caption" color="text.secondary">
                Session expires: {new Date(auth.expiresAt).toLocaleString()}
              </Typography>
            )}
            {mcp && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                MCP: {mcp.state} {mcp.active ? '(active)' : ''}
              </Typography>
            )}
            {(auth?.connectedIntegrations?.length ?? 0) > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {auth!.connectedIntegrations.length} integration{auth!.connectedIntegrations.length !== 1 ? 's' : ''} connected
              </Typography>
            )}
            <Box sx={{ mt: 2 }}>
              <Button size="small" color="error" variant="outlined" onClick={onLogout}>
                Disconnect
              </Button>
            </Box>
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Connect to AgentLink to securely access third-party integrations. Credentials never touch your local machine.
            </Typography>
            <Button
              variant="contained"
              size="small"
              onClick={onConnect}
              disabled={connecting}
              startIcon={connecting ? <RefreshCw size={14} /> : <Link2 size={14} />}
            >
              {connecting ? 'Connecting...' : 'Connect AgentLink'}
            </Button>
            {error && (
              <Alert severity="error" sx={{ mt: 1 }} variant="outlined">
                {error}
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
