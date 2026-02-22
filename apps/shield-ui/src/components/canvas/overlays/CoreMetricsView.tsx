/**
 * CoreMetricsView — recharts-based real-time metrics chart for the 4 core system components.
 *
 * Receives a `tab` prop ('cpu' | 'memory' | 'disk' | 'network') and renders
 * an AreaChart from the rolling metricsHistory buffer in systemStore.
 */

import { useMemo, useEffect } from 'react';
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
import { systemStore, pushMetricsSnapshot, type MetricsSnapshot } from '../../../state/system-store';
import { useMetricsHistory } from '../../../api/hooks';
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
  compact?: boolean;
}

export default function CoreMetricsView({ tab, compact }: CoreMetricsViewProps) {
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
      <div style={{ width: '100%', height: compact ? 180 : 320 }}>
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
      {latest && !compact && (
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
          padding: compact ? 20 : 40,
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

/* ---- Status card for AllMetricsView ---- */

interface StatusCardProps {
  label: string;
  value: string;
  accentColor: string;
  isDark: boolean;
}

function StatusCard({ label, value, accentColor, isDark }: StatusCardProps) {
  return (
    <div style={{
      flex: 1,
      padding: '12px 16px',
      borderRadius: 6,
      background: isDark ? pcb.component.body : pcb.light.body,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: accentColor,
        opacity: 0.6,
      }} />
      <div style={{
        fontSize: 10,
        fontFamily: "'IBM Plex Mono', monospace",
        color: isDark ? pcb.silk.dim : pcb.light.silkDim,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 14,
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 600,
        color: isDark ? pcb.silk.primary : pcb.light.silk,
      }}>
        {value}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatMemory(bytes: number): string {
  if (bytes <= 0) return '--';
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/* ---- AllMetricsView: 4 charts + status cards ---- */

const METRICS_TABS: MetricsTab[] = ['cpu', 'memory', 'disk', 'network'];

const TAB_LABELS: Record<MetricsTab, { label: string; accent: string }> = {
  cpu: { label: 'CPU', accent: pcb.accent.cpu },
  memory: { label: 'Memory', accent: pcb.accent.memory },
  disk: { label: 'Disk', accent: pcb.accent.disk },
  network: { label: 'Network', accent: pcb.accent.network },
};

export function AllMetricsView() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const snap = useSnapshot(systemStore);
  const sysInfo = snap.systemInfo;
  const m = snap.metrics;
  const loaded = snap.metricsLoaded;

  // Self-sufficient backfill: fetch metrics history from daemon on mount.
  // This ensures data is available even when navigating directly to /metrics
  // (where the Canvas-level useSetupCanvasData hook may not have fired yet).
  const { data: historyData } = useMetricsHistory();

  useEffect(() => {
    if (historyData && historyData.length > 0 && systemStore.metricsHistory.length === 0) {
      const existing = new Set(systemStore.metricsHistory.map((s) => s.timestamp));
      const newSnapshots = historyData.filter((s) => !existing.has(s.timestamp));
      if (newSnapshots.length > 0) {
        systemStore.metricsHistory.unshift(...newSnapshots);
      }
    }
  }, [historyData]);

  return (
    <div style={{ padding: '8px 16px 16px' }}>
      {/* Status cards row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <StatusCard
          label="Hostname"
          value={sysInfo?.hostname ?? '--'}
          accentColor={pcb.trace.silver}
          isDark={isDark}
        />
        <StatusCard
          label="Platform"
          value={sysInfo ? `${sysInfo.platform} / ${sysInfo.arch}` : '--'}
          accentColor={pcb.trace.silver}
          isDark={isDark}
        />
        <StatusCard
          label="Uptime"
          value={sysInfo ? formatUptime(sysInfo.uptime) : '--'}
          accentColor={pcb.accent.cpu}
          isDark={isDark}
        />
        <StatusCard
          label="Total Memory"
          value={sysInfo ? formatMemory(sysInfo.totalMemory) : '--'}
          accentColor={pcb.accent.memory}
          isDark={isDark}
        />
      </div>

      {/* 2x2 charts grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
      }}>
        {METRICS_TABS.map((tab) => {
          const meta = TAB_LABELS[tab];
          const config = TAB_CONFIG[tab];
          const latest = loaded ? snap.metricsHistory.length > 0
            ? snap.metricsHistory[snap.metricsHistory.length - 1]
            : null : null;

          return (
            <div
              key={tab}
              style={{
                borderRadius: 6,
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                background: isDark ? pcb.component.body : pcb.light.body,
                overflow: 'hidden',
              }}
            >
              {/* Chart header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px 0',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: meta.accent,
                    boxShadow: `0 0 4px ${meta.accent}`,
                  }} />
                  <span style={{
                    fontSize: 11,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontWeight: 600,
                    color: meta.accent,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}>
                    {meta.label}
                  </span>
                </div>
                {latest && (
                  <span style={{
                    fontSize: 12,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontWeight: 600,
                    color: isDark ? pcb.silk.primary : pcb.light.silk,
                  }}>
                    {config.series.map((s) =>
                      config.formatter((latest as Record<string, number>)[s.dataKey as string] ?? 0),
                    ).join(' / ')}
                  </span>
                )}
              </div>

              {/* Chart body */}
              <CoreMetricsView tab={tab} compact />
            </div>
          );
        })}
      </div>
    </div>
  );
}
