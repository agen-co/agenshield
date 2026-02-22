/**
 * MiniSparkline — tiny background SVG polyline for chip nodes.
 *
 * Reads the rolling metricsHistory from systemStore and renders a faint
 * sparkline within the given rect bounds. No axes, no labels — purely
 * decorative background indicator.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { systemStore, type MetricsSnapshot } from '../../../../../state/system-store';

interface MiniSparklineProps {
  dataKey: keyof MetricsSnapshot;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  maxPoints?: number;
}

export const MiniSparkline = memo(({ dataKey, x, y, w, h, color, maxPoints = 40 }: MiniSparklineProps) => {
  const { metricsHistory } = useSnapshot(systemStore);

  if (metricsHistory.length < 2) return null;

  // Take the last N points
  const points = metricsHistory.slice(-maxPoints);
  const values = points.map((p) => p[dataKey] as number);

  // Compute range for scaling
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Build polyline points string
  const polyPoints = values
    .map((v, i) => {
      const px = x + (i / (values.length - 1)) * w;
      const py = y + h - ((v - min) / range) * h;
      return `${px},${py}`;
    })
    .join(' ');

  return (
    <polyline
      points={polyPoints}
      fill="none"
      stroke={color}
      strokeWidth={0.8}
      opacity={0.1}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
});
MiniSparkline.displayName = 'MiniSparkline';
