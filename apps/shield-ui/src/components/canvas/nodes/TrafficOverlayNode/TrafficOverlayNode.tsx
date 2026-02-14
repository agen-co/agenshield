import { memo, useMemo, useState, useEffect, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { OverlayWrapper } from './TrafficOverlayNode.styles';
import type { TrafficOverlayData } from '../../Canvas.types';

/** Generate smooth random placeholder data */
function nextRandom(prev: number, min: number, max: number): number {
  const drift = (Math.random() - 0.5) * (max - min) * 0.2;
  return Math.max(min, Math.min(max, prev + drift));
}

function generatePlaceholder(): { value: number }[] {
  const data: { value: number }[] = [];
  let v = 3 + Math.random() * 4;
  for (let i = 0; i < 40; i++) {
    v = nextRandom(v, 1, 10);
    data.push({ value: v });
  }
  return data;
}

export const TrafficOverlayNode = memo(({ data }: NodeProps) => {
  const { events, width } = data as unknown as TrafficOverlayData;
  const theme = useTheme();

  const [placeholder, setPlaceholder] = useState(generatePlaceholder);

  const tick = useCallback(() => {
    setPlaceholder((prev) => {
      const last = prev[prev.length - 1];
      const v = nextRandom(last.value, 1, 10);
      return [...prev.slice(1), { value: v }];
    });
  }, []);

  useEffect(() => {
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [tick]);

  const chartData = useMemo(() => {
    if (events.length < 3) return placeholder;
    // Bucket events into 40 bins
    const bins: { value: number }[] = [];
    const binSize = Math.max(1, Math.floor(events.length / 40));
    for (let i = 0; i < 40; i++) {
      bins.push({ value: Math.min(10, events.slice(i * binSize, (i + 1) * binSize).length) });
    }
    return bins;
  }, [events, placeholder]);

  const fillColor = theme.palette.mode === 'dark'
    ? `${theme.palette.primary.main}15`
    : `${theme.palette.primary.main}10`;
  const strokeColor = theme.palette.mode === 'dark'
    ? theme.palette.grey[700]
    : theme.palette.grey[300];

  return (
    <OverlayWrapper style={{ width: width || '100%' }}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <Area
            type="natural"
            dataKey="value"
            stroke={strokeColor}
            fill={fillColor}
            strokeWidth={1}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </OverlayWrapper>
  );
});
TrafficOverlayNode.displayName = 'TrafficOverlayNode';
