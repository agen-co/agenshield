/**
 * CoreMetricsView — recharts-based real-time metrics chart for the 4 core system components.
 *
 * Receives a `tab` prop ('cpu' | 'memory' | 'disk' | 'network') and renders
 * an AreaChart from the rolling metricsHistory buffer in systemStore.
 */

import { useMemo } from 'react';
import { useSnapshot } from 'valtio';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@mui/material/styles';
import { systemStore, type MetricsSnapshot } from '../../../state/system-store';
import { pcb } from '../styles/pcb-tokens';

export type MetricsTab = 'cpu' | 'memory' | 'disk' | 'network';

interface Series {
  dataKey: keyof MetricsSnapshot;
  label: string;
  color: string;
}

interface TabConfig {
  series: Series[];
  yDomain: [number, number] | ['auto', 'auto'];
  formatter: (v: number) => string;
  unit: string;
}

const TAB_CONFIG: Record<MetricsTab, TabConfig> = {
  cpu: {
    series: [{ dataKey: 'cpuPercent', label: 'CPU', color: pcb.component.ledGreen }],
    yDomain: [0, 100],
    formatter: (v) => `${v.toFixed(1)}%`,
    unit: '%',
  },
  memory: {
    series: [{ dataKey: 'memPercent', label: 'Memory', color: pcb.signal.cyan }],
    yDomain: [0, 100],
    formatter: (v) => `${v.toFixed(1)}%`,
    unit: '%',
  },
  disk: {
    series: [{ dataKey: 'diskPercent', label: 'Disk', color: pcb.component.ledAmber }],
    yDomain: [0, 100],
    formatter: (v) => `${v.toFixed(1)}%`,
    unit: '%',
  },
  network: {
    series: [
      { dataKey: 'netUp', label: 'Upload', color: pcb.component.ledGreen },
      { dataKey: 'netDown', label: 'Download', color: pcb.signal.cyan },
    ],
    yDomain: ['auto', 'auto'],
    formatter: (v) => {
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} MB/s`;
      if (v >= 1_000) return `${(v / 1_000).toFixed(0)} KB/s`;
      return `${v.toFixed(0)} B/s`;
    },
    unit: '',
  },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

interface CoreMetricsViewProps {
  tab: MetricsTab;
}

export default function CoreMetricsView({ tab }: CoreMetricsViewProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { metricsHistory } = useSnapshot(systemStore);

  const config = TAB_CONFIG[tab];

  const chartData = useMemo(
    () => metricsHistory.map((snap) => ({ ...snap })),
    [metricsHistory],
  );

  // Latest values for live indicator
  const latest = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const axisColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';

  return (
    <div style={{ padding: '16px 0' }}>
      {/* Chart */}
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTime}
              tick={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", fill: axisColor }}
              stroke={gridColor}
              minTickGap={40}
            />
            <YAxis
              domain={config.yDomain}
              tick={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", fill: axisColor }}
              stroke={gridColor}
              width={52}
              tickFormatter={(v: number) => config.unit ? `${v}${config.unit}` : config.formatter(v)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: isDark ? '#1C1C20' : '#FFFFFF',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
              labelFormatter={(v) => formatTime(v as number)}
              formatter={(value, name) => {
                const s = config.series.find((s) => s.dataKey === name);
                return [config.formatter(value as number), s?.label ?? name];
              }}
            />
            {config.series.map((s) => (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.12}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Live values */}
      {latest && (
        <div style={{
          display: 'flex',
          gap: 24,
          padding: '16px 16px 0',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13,
        }}>
          {config.series.map((s) => (
            <div key={s.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: s.color,
                boxShadow: `0 0 6px ${s.color}`,
              }} />
              <span style={{ color: theme.palette.text.secondary }}>{s.label}</span>
              <span style={{ color: theme.palette.text.primary, fontWeight: 600 }}>
                {config.formatter(latest[s.dataKey] as number)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {chartData.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: 40,
          color: theme.palette.text.secondary,
          fontFamily: "'Manrope', sans-serif",
          fontSize: 14,
        }}>
          Waiting for metrics data...
        </div>
      )}
    </div>
  );
}
