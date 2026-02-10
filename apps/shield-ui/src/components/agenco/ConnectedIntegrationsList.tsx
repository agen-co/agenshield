/**
 * List of connected integrations
 */

import {
  Box,
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Skeleton,
  Button,
} from '@mui/material';
import { Plug, AlertTriangle, Zap, Download, RefreshCw } from 'lucide-react';
import { EmptyState } from '../shared/EmptyState';

export interface ConnectedIntegrationData {
  id: string;
  name: string;
  connectedAt: string;
  status: string;
  account?: string;
  requiresReauth?: boolean;
}

interface ConnectedIntegrationsListProps {
  integrations: ConnectedIntegrationData[];
  loading: boolean;
  installedSkillIds?: Set<string>;
  onSyncSkills?: () => void;
  syncing?: boolean;
}

export function ConnectedIntegrationsList({
  integrations,
  loading,
  installedSkillIds,
  onSyncSkills,
  syncing,
}: ConnectedIntegrationsListProps) {
  if (loading) {
    return (
      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
            Connected Integrations
          </Typography>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="rectangular" height={48} sx={{ borderRadius: 1, mb: 1 }} />
          ))}
        </CardContent>
      </Card>
    );
  }

  const hasMissingSkills = installedSkillIds && integrations.some(
    (i) => !installedSkillIds.has(i.id)
  );

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Connected Integrations
          </Typography>
          {hasMissingSkills && onSyncSkills && (
            <Button
              size="small"
              variant="contained"
              onClick={onSyncSkills}
              disabled={syncing}
              startIcon={syncing ? <RefreshCw size={14} /> : <Download size={14} />}
            >
              {syncing ? 'Installing...' : 'Install Skills'}
            </Button>
          )}
        </Box>
        {integrations.length === 0 ? (
          <EmptyState
            icon={<Plug size={24} />}
            title="No integrations connected"
            description="Connect integrations from the marketplace below."
          />
        ) : (
          <List disablePadding>
            {integrations.map((integration) => {
              const skillInstalled = installedSkillIds?.has(integration.id);
              return (
                <ListItem key={integration.id} sx={{ px: 0 }}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {integration.requiresReauth ? (
                      <AlertTriangle size={18} color="orange" />
                    ) : (
                      <Plug size={18} />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={500}>
                          {integration.name}
                        </Typography>
                        <Chip
                          label={integration.requiresReauth ? 'Re-auth needed' : integration.status}
                          color={integration.requiresReauth ? 'warning' : 'success'}
                          size="small"
                          variant="outlined"
                        />
                        {skillInstalled && (
                          <Chip
                            icon={<Zap size={12} />}
                            label="Skill"
                            size="small"
                            color="info"
                            variant="outlined"
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {integration.account ? `${integration.account} - ` : ''}
                        Connected {new Date(integration.connectedAt).toLocaleDateString()}
                      </Typography>
                    }
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
