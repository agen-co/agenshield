/**
 * MetricCard — compact stat card with a mini sparkline chart.
 *
 * Reads from systemStore.metricsHistory to render a trend sparkline.
 * Pass `compact` for a denser layout used in the monitor overview.
 */

import { memo, useMemo } from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSnapshot } from 'valtio';
import { systemStore, type MetricsSnapshot } from '../../state/system-store';

interface MetricCardProps {
  label: string;
  dataKey: keyof MetricsSnapshot;
  unit?: string;
  formatValue?: (v: number) => string;
  compact?: boolean;
}

function defaultFormat(v: number, unit?: string): string {
  if (unit === 'B/s') {
    if (v > 1_000_000) return `${(v / 1_000_000).toFixed(1)} MB/s`;
    if (v > 1_000) return `${(v / 1_000).toFixed(1)} KB/s`;
    return `${Math.round(v)} B/s`;
  }
  return `${v.toFixed(1)}${unit ?? '%'}`;
}

/** Pick a gauge color based on 0-100 value */
function gaugeColor(percent: number, palette: { success: { main: string }; warning: { main: string }; error: { main: string } }) {
  if (percent < 60) return palette.success.main;
  if (percent < 85) return palette.warning.main;
  return palette.error.main;
}

const SPARKLINE_POINTS = 60;
const SPARKLINE_W = 140;

export const MetricCard = memo(({ label, dataKey, unit, formatValue, compact }: MetricCardProps) => {
  const theme = useTheme();
  const snap = useSnapshot(systemStore);
  const currentValue = snap.metrics[dataKey as keyof typeof snap.metrics] as number ?? 0;
  const history = snap.metricsHistory;

  const isPercentMetric = !unit || unit === '%';
  const color = isPercentMetric ? gaugeColor(currentValue, theme.palette) : theme.palette.info.main;
  const displayValue = formatValue ? formatValue(currentValue) : defaultFormat(currentValue, unit);

  const sparklineH = compact ? 20 : 32;

  const polyline = useMemo(() => {
    if (history.length < 2) return '';
    const points = history.slice(-SPARKLINE_POINTS);
    const values = points.map((p) => p[dataKey] as number);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return values
      .map((v, i) => {
        const px = (i / (values.length - 1)) * SPARKLINE_W;
        const py = sparklineH - ((v - min) / range) * sparklineH;
        return `${px},${py}`;
      })
      .join(' ');
  }, [history, dataKey, sparklineH]);

  return (
    <Card sx={{ flex: 1, minWidth: compact ? 140 : 180 }}>
      <CardContent sx={{
        py: compact ? 0.75 : 1.5,
        px: compact ? 1.5 : 2,
        '&:last-child': { pb: compact ? 0.75 : 1.5 },
      }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: compact ? 0.25 : 0.5 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            fontWeight={600}
            sx={{
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontSize: compact ? 10 : undefined,
            }}
          >
            {label}
          </Typography>
          <Typography
            variant={compact ? 'body2' : 'h6'}
            fontWeight={700}
            sx={{
              color,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: compact ? 14 : 18,
            }}
          >
            {displayValue}
          </Typography>
        </Box>
        <svg
          width={SPARKLINE_W}
          height={sparklineH}
          viewBox={`0 0 ${SPARKLINE_W} ${sparklineH}`}
          style={{ width: '100%', height: sparklineH }}
        >
          {polyline && (
            <>
              <polygon
                points={`0,${sparklineH} ${polyline} ${SPARKLINE_W},${sparklineH}`}
                fill={color}
                opacity={0.08}
              />
              <polyline
                points={polyline}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.6}
              />
            </>
          )}
        </svg>
      </CardContent>
    </Card>
  );
});
MetricCard.displayName = 'MetricCard';
