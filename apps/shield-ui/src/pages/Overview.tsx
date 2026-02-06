/**
 * Overview page - enhanced dashboard with charts and activity
 */

import {
  Box,
  Card,
  CardContent,
  Typography,
  Skeleton,
  Chip,
} from '@mui/material';
import { useStatus, useConfig, useSecurity } from '../api/hooks';
import { tokens } from '../styles/tokens';
import { slideIn } from '../styles/animations';
import { PageHeader } from '../components/shared/PageHeader';
import { StatsRow } from '../components/overview/StatsRow';
import { TrafficChart } from '../components/overview/TrafficChart';
import { ActivityFeed } from '../components/overview/ActivityFeed';
import { SecurityStatusCard } from '../components/overview/SecurityStatus';

export function Overview() {
  const { data: status, isLoading: statusLoading } = useStatus();
  const { data: config, isLoading: configLoading } = useConfig();
  const { data: security } = useSecurity();

  const daemonStatus = status?.data;
  const shieldConfig = config?.data;
  const statusPending = statusLoading || !daemonStatus;
  const configPending = configLoading || !shieldConfig;

  const cardAnim = (delay: number) => ({
    animation: `${slideIn} 0.4s ease-out ${delay}ms both`,
  });

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Overview"
        description="Monitor your AgenShield daemon status and activity."
      />

      <StatsRow
        status={status}
        config={config}
        security={security}
        statusLoading={statusLoading}
        configLoading={configLoading}
      />

      {/* Two-column layout: left (main) + right (sidebar) */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 360px' },
          gap: 3,
          mt: 3,
        }}
      >
        {/* Left column - main content */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Box sx={cardAnim(100)}>
            <TrafficChart />
          </Box>
          <Box sx={cardAnim(200)}>
            <ActivityFeed />
          </Box>
        </Box>

        {/* Right column - stacked cards */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Box sx={cardAnim(150)}>
            <SecurityStatusCard />
          </Box>
          <Card sx={cardAnim(250)}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Daemon Information
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">Version</Typography>
                  <Typography variant="body1">
                    {statusPending ? <Skeleton width={100} /> : daemonStatus?.version}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">Port</Typography>
                  <Typography variant="body1">
                    {statusPending ? <Skeleton width={100} /> : daemonStatus?.port}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">Started At</Typography>
                  <Typography variant="body1">
                    {statusPending ? (
                      <Skeleton width={200} />
                    ) : daemonStatus?.startedAt ? (
                      new Date(daemonStatus.startedAt).toLocaleString()
                    ) : (
                      <Skeleton width={200} />
                    )}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">Log Level</Typography>
                  <Box>
                    {configPending ? (
                      <Skeleton width={100} />
                    ) : (
                      <Chip
                        label={shieldConfig?.daemon?.logLevel ?? 'info'}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                </Box>
                {daemonStatus?.agentUsername && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">Agent User</Typography>
                    <Typography variant="body1" fontFamily="'IBM Plex Mono', monospace">
                      {daemonStatus.agentUsername}
                    </Typography>
                  </Box>
                )}
                {daemonStatus?.workspaceGroup && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">Workspace Group</Typography>
                    <Typography variant="body1" fontFamily="'IBM Plex Mono', monospace">
                      {daemonStatus.workspaceGroup}
                    </Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </Box>
  );
}
