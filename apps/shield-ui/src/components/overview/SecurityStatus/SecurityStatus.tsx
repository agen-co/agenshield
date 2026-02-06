import { Card, CardContent, Typography, Skeleton } from '@mui/material';
import { useSecurity } from '../../../api/hooks';
import { StatusBadge } from '../../shared/StatusBadge';
import { MetricRow } from './SecurityStatus.styles';

function levelToVariant(level: string) {
  if (level === 'secure') return 'success' as const;
  if (level === 'partial') return 'warning' as const;
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
          <Typography variant="body2" color="text.secondary">Sandbox User</Typography>
          <Typography variant="body2" fontWeight={500}>
            {pending ? <Skeleton width={30} /> : sec.sandboxUserExists ? 'Created' : 'Missing'}
          </Typography>
        </MetricRow>
        <MetricRow>
          <Typography variant="body2" color="text.secondary">Isolation</Typography>
          <Typography variant="body2" fontWeight={500}>
            {pending ? <Skeleton width={30} /> : sec.isIsolated ? 'Isolated' : 'Not isolated'}
          </Typography>
        </MetricRow>
        <MetricRow>
          <Typography variant="body2" color="text.secondary">Warnings</Typography>
          <Typography variant="body2" fontWeight={500} color={sec?.warnings?.length ? 'warning.main' : undefined}>
            {pending ? <Skeleton width={30} /> : sec.warnings.length}
          </Typography>
        </MetricRow>
        <MetricRow>
          <Typography variant="body2" color="text.secondary">Exposed Secrets</Typography>
          <Typography variant="body2" fontWeight={500} color={sec?.exposedSecrets?.length ? 'error.main' : undefined}>
            {pending ? <Skeleton width={30} /> : sec.exposedSecrets.length}
          </Typography>
        </MetricRow>
      </CardContent>
    </Card>
  );
}
