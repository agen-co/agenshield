/**
 * TargetMetricCard — compact stat card with a mini sparkline chart for per-target metrics.
 *
 * Reads from systemStore.targetMetricsHistory[targetId] to render a trend sparkline.
 * Same visual pattern as MetricCard but scoped to a specific target.
 */

import { memo, useMemo } from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSnapshot } from 'valtio';
import { systemStore, type TargetMetricsSnapshot } from '../../state/system-store';

interface TargetMetricCardProps {
  label: string;
  targetId: string;
  dataKey: keyof TargetMetricsSnapshot;
  compact?: boolean;
}

function gaugeColor(percent: number, palette: { success: { main: string }; warning: { main: string }; error: { main: string } }) {
  if (percent < 60) return palette.success.main;
  if (percent < 85) return palette.warning.main;
  return palette.error.main;
}

const SPARKLINE_POINTS = 60;
const SPARKLINE_W = 140;

export const TargetMetricCard = memo(({ label, targetId, dataKey, compact }: TargetMetricCardProps) => {
  const theme = useTheme();
  const snap = useSnapshot(systemStore);
  const history = (snap.targetMetricsHistory[targetId] ?? []) as TargetMetricsSnapshot[];
  const currentValue = history.length > 0 ? (history[history.length - 1][dataKey] as number) : 0;

  const color = gaugeColor(currentValue, theme.palette);
  const displayValue = `${currentValue.toFixed(1)}%`;

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
TargetMetricCard.displayName = 'TargetMetricCard';
