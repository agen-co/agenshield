import { useState, useMemo, useEffect, useCallback } from 'react';
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
import { useSnapshot } from 'valtio';
import { eventStore } from '../../../state/events';
import { useHealthGate } from '../../../api/hooks';
import { TimeRangeGroup } from './TrafficChart.styles';

type TimeRange = '1h' | '6h' | '24h' | '7d';

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
];

const PLACEHOLDER_POINTS = 30;
const PLACEHOLDER_Y_MIN = 0;
const PLACEHOLDER_Y_MAX = 10;

function getTimeThreshold(range: TimeRange): Date {
  const now = new Date();
  switch (range) {
    case '1h': return subHours(now, 1);
    case '6h': return subHours(now, 6);
    case '24h': return subHours(now, 24);
    case '7d': return subDays(now, 7);
  }
}

/** Returns the bucket interval in seconds and a display format for each range */
function getBucketConfig(range: TimeRange): { intervalSec: number; displayFmt: string } {
  switch (range) {
    case '1h': return { intervalSec: 60, displayFmt: 'HH:mm' };
    case '6h': return { intervalSec: 5 * 60, displayFmt: 'HH:mm' };
    case '24h': return { intervalSec: 60 * 60, displayFmt: 'HH:00' };
    case '7d': return { intervalSec: 60 * 60 * 24, displayFmt: 'EEE' };
  }
}

/** Floor a timestamp (Date or epoch ms) to the nearest interval boundary */
function floorToInterval(date: Date | number, intervalSec: number): Date {
  const ms = intervalSec * 1000;
  const epoch = typeof date === 'number' ? date : date.getTime();
  return new Date(Math.floor(epoch / ms) * ms);
}

/** Generate a single random data point that drifts smoothly from prev */
function nextRandom(prev: number, min: number, max: number): number {
  const drift = (Math.random() - 0.5) * (max - min) * 0.2;
  return Math.max(min, Math.min(max, prev + drift));
}

function generatePlaceholder(): { time: string; requests: number; blocked: number }[] {
  const data: { time: string; requests: number; blocked: number }[] = [];
  let req = 3 + Math.random() * 4;
  let blk = 1 + Math.random() * 2;
  for (let i = 0; i < PLACEHOLDER_POINTS; i++) {
    req = nextRandom(req, 1, PLACEHOLDER_Y_MAX);
    blk = nextRandom(blk, 0, Math.min(req, 4));
    data.push({ time: '', requests: req, blocked: blk });
  }
  return data;
}

/** Hook that returns rolling random placeholder data, ticking every interval */
function usePlaceholderData(active: boolean) {
  const [data, setData] = useState(generatePlaceholder);

  const tick = useCallback(() => {
    setData((prev) => {
      const last = prev[prev.length - 1];
      const req = nextRandom(last.requests, 1, PLACEHOLDER_Y_MAX);
      const blk = nextRandom(last.blocked, 0, Math.min(req, 4));
      return [...prev.slice(1), { time: '', requests: req, blocked: blk }];
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, tick]);

  return data;
}

export function TrafficChart() {
  const theme = useTheme();
  const [range, setRange] = useState<TimeRange>('1h');
  const { events } = useSnapshot(eventStore);
  const healthy = useHealthGate();

  // Tick every second so chart picks up new events promptly
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const chartData = useMemo(() => {
    const threshold = getTimeThreshold(range);
    const { intervalSec, displayFmt } = getBucketConfig(range);
    const filtered = events.filter((e) => isAfter(e.timestamp, threshold));

    const buckets = new Map<number, { requests: number; blocked: number }>();
    for (const event of filtered) {
      const floored = floorToInterval(event.timestamp, intervalSec);
      const key = floored.getTime();
      const bucket = buckets.get(key) ?? { requests: 0, blocked: 0 };
      bucket.requests++;
      if (event.type === 'security:alert') bucket.blocked++;
      buckets.set(key, bucket);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([ts, data]) => ({ time: format(new Date(ts), displayFmt), ...data }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, range, tick]);

  const isEmpty = !healthy || chartData.length === 0;
  const placeholderData = usePlaceholderData(isEmpty);
  const greyColor = theme.palette.mode =='dark' ? theme.palette.grey[600] : theme.palette.grey[400];

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
                sx={{ minWidth: 36 }}
              >
                {tr.label}
              </Button>
            ))}
          </TimeRangeGroup>
        </Box>

        <Box sx={{ position: 'relative' }}>
          {isEmpty && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {!healthy
                  ? 'Waiting for daemon connection...'
                  : 'No traffic data yet. Data will appear as requests come in.'}
              </Typography>
            </Box>
          )}

          <Box sx={{ opacity: isEmpty ? 0.3 : 1, transition: 'opacity 0.6s ease' }}>
            <ResponsiveContainer width="100%" height={280} minWidth={100}>
              <AreaChart data={isEmpty ? placeholderData : chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={theme.palette.divider}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 12, fill: isEmpty ? 'transparent' : theme.palette.text.secondary }}
                  axisLine={{ stroke: theme.palette.divider }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: isEmpty ? 'transparent' : theme.palette.text.secondary }}
                  axisLine={{ stroke: theme.palette.divider }}
                  domain={isEmpty ? [PLACEHOLDER_Y_MIN, PLACEHOLDER_Y_MAX] : undefined}
                />
                {!isEmpty && (
                  <Tooltip
                    contentStyle={{
                      backgroundColor: theme.palette.background.paper,
                      border: `1px solid ${theme.palette.divider}`,
                      borderRadius: 8,
                      fontSize: 13,
                    }}
                  />
                )}
                <Area
                  type="natural"
                  dataKey="requests"
                  stroke={isEmpty ? greyColor : theme.palette.primary.main}
                  fill={isEmpty ? `${greyColor}18` : `${theme.palette.primary.main}20`}
                  strokeWidth={isEmpty ? 1.5 : 2}
                  name="Requests"
                  isAnimationActive={false}
                />
                <Area
                  type="natural"
                  dataKey="blocked"
                  stroke={isEmpty ? greyColor : theme.palette.error.main}
                  fill={isEmpty ? `${greyColor}10` : `${theme.palette.error.main}20`}
                  strokeWidth={isEmpty ? 1.5 : 2}
                  name="Blocked"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
