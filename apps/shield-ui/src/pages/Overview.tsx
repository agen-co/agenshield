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
  Grid2 as Grid,
} from '@mui/material';
import { useStatus, useConfig, useSecurity } from '../api/hooks';
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

  return (
    <Box>
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

      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <TrafficChart />
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <SecurityStatusCard />
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <ActivityFeed />
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Daemon Information
              </Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" color="text.secondary">Version</Typography>
                  <Typography variant="body1">
                    {statusLoading ? <Skeleton width={100} /> : daemonStatus?.version ?? '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" color="text.secondary">Port</Typography>
                  <Typography variant="body1">
                    {statusLoading ? <Skeleton width={100} /> : daemonStatus?.port ?? '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" color="text.secondary">Started At</Typography>
                  <Typography variant="body1">
                    {statusLoading ? (
                      <Skeleton width={200} />
                    ) : daemonStatus?.startedAt ? (
                      new Date(daemonStatus.startedAt).toLocaleString()
                    ) : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" color="text.secondary">Log Level</Typography>
                  <Box>
                    {configLoading ? (
                      <Skeleton width={100} />
                    ) : (
                      <Chip
                        label={shieldConfig?.daemon?.logLevel ?? 'info'}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
