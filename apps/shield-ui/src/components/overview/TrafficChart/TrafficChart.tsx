import { useState, useMemo } from 'react';
import { Card, CardContent, Typography, Box, Button, useTheme } from '@mui/material';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, subHours, subDays, isAfter } from 'date-fns';
import { useEventStore } from '../../../state/events';
import { TimeRangeGroup } from './TrafficChart.styles';

type TimeRange = '1h' | '6h' | '24h' | '7d';

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
];

function getTimeThreshold(range: TimeRange): Date {
  const now = new Date();
  switch (range) {
    case '1h': return subHours(now, 1);
    case '6h': return subHours(now, 6);
    case '24h': return subHours(now, 24);
    case '7d': return subDays(now, 7);
  }
}

function getBucketFormat(range: TimeRange): string {
  switch (range) {
    case '1h': return 'HH:mm';
    case '6h': return 'HH:mm';
    case '24h': return 'HH:00';
    case '7d': return 'EEE';
  }
}

export function TrafficChart() {
  const theme = useTheme();
  const [range, setRange] = useState<TimeRange>('1h');
  const events = useEventStore((s) => s.events);

  const chartData = useMemo(() => {
    const threshold = getTimeThreshold(range);
    const fmt = getBucketFormat(range);
    const filtered = events.filter((e) => isAfter(e.timestamp, threshold));

    const buckets = new Map<string, { requests: number; blocked: number }>();
    for (const event of filtered) {
      const key = format(event.timestamp, fmt);
      const bucket = buckets.get(key) ?? { requests: 0, blocked: 0 };
      bucket.requests++;
      if (event.type === 'security:alert') bucket.blocked++;
      buckets.set(key, bucket);
    }

    return Array.from(buckets.entries())
      .map(([time, data]) => ({ time, ...data }))
      .reverse();
  }, [events, range]);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>
            Traffic
          </Typography>
          <TimeRangeGroup>
            {TIME_RANGES.map((tr) => (
              <Button
                key={tr.value}
                size="small"
                variant={range === tr.value ? 'contained' : 'text'}
                onClick={() => setRange(tr.value)}
                sx={{ minWidth: 40, px: 1 }}
              >
                {tr.label}
              </Button>
            ))}
          </TimeRangeGroup>
        </Box>

        <ResponsiveContainer width="100%" height={280} minWidth={100}>
          <AreaChart data={chartData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.palette.divider}
            />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              axisLine={{ stroke: theme.palette.divider }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              axisLine={{ stroke: theme.palette.divider }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 8,
                fontSize: 13,
              }}
            />
            <Area
              type="monotone"
              dataKey="requests"
              stroke={theme.palette.primary.main}
              fill={`${theme.palette.primary.main}20`}
              strokeWidth={2}
              name="Requests"
            />
            <Area
              type="monotone"
              dataKey="blocked"
              stroke={theme.palette.error.main}
              fill={`${theme.palette.error.main}20`}
              strokeWidth={2}
              name="Blocked"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
