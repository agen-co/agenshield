import { Card, CardContent, Typography, Skeleton } from '@mui/material';
import { useSecurity } from '../../../api/hooks';
import { StatusBadge } from '../../shared/StatusBadge';
import { MetricRow } from './SecurityStatus.styles';

function levelToVariant(level: string) {
  if (level === 'high') return 'success' as const;
  if (level === 'medium') return 'warning' as const;
  return 'error' as const;
}

export function SecurityStatusCard() {
  const { data: security, isLoading } = useSecurity();
  const sec = security?.data;
  const pending = isLoading || !sec;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom fontWeight={600}>
          Security Status
        </Typography>
        <MetricRow>
          <Typography variant="body2" color="text.secondary">Protection Level</Typography>
          {pending ? (
            <Skeleton width={80} />
          ) : (
            <StatusBadge
              label={sec.level.charAt(0).toUpperCase() + sec.level.slice(1)}
              variant={levelToVariant(sec.level)}
            />
          )}
        </MetricRow>
        <MetricRow>
          <Typography variant="body2" color="text.secondary">Active Policies</Typography>
          <Typography variant="body2" fontWeight={500}>
            {pending ? <Skeleton width={30} /> : sec.activePolicies}
          </Typography>
        </MetricRow>
        <MetricRow>
          <Typography variant="body2" color="text.secondary">Blocked Requests</Typography>
          <Typography variant="body2" fontWeight={500} color="error.main">
            {pending ? <Skeleton width={30} /> : sec.blockedRequests}
          </Typography>
        </MetricRow>
        <MetricRow>
          <Typography variant="body2" color="text.secondary">Total Requests</Typography>
          <Typography variant="body2" fontWeight={500}>
            {pending ? <Skeleton width={30} /> : sec.totalRequests}
          </Typography>
        </MetricRow>
        {sec?.lastIncident && (
          <MetricRow>
            <Typography variant="body2" color="text.secondary">Last Incident</Typography>
            <Typography variant="body2" fontWeight={500}>
              {new Date(sec.lastIncident).toLocaleString()}
            </Typography>
          </MetricRow>
        )}
      </CardContent>
    </Card>
  );
}
