/**
 * CoreMetricsView — recharts-based real-time metrics chart for the 4 core system components.
 *
 * Receives a `tab` prop ('cpu' | 'memory' | 'disk' | 'network') and renders
 * an AreaChart from the rolling metricsHistory buffer in systemStore.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSnapshot } from 'valtio';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useTheme } from '@mui/material/styles';
import { systemStore, pushTargetMetricsSnapshot, type MetricsSnapshot, type EventLoopSnapshot } from '../../../state/system-store';
import { targetsStore } from '../../../state/targets';
import { useTargetMetricsHistory } from '../../../api/hooks';
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

/** Target-specific data keys added to merged chart data */
const TARGET_DATA_KEYS = {
  cpu: 'targetCpuPercent',
  memory: 'targetMemPercent',
} as const;

const TARGET_OVERLAY_COLOR = '#FF6B6B';

interface CoreMetricsViewProps {
  tab: MetricsTab;
  compact?: boolean;
  syncId?: string;
  targetId?: string | null;
  targetName?: string;
}

export default function CoreMetricsView({ tab, compact, syncId, targetId, targetName }: CoreMetricsViewProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { metricsHistory, targetMetricsHistory } = useSnapshot(systemStore);

  const config = TAB_CONFIG[tab];
  const hasTargetOverlay = !!targetId && (tab === 'cpu' || tab === 'memory');

  const chartData = useMemo(() => {
    const base = metricsHistory.map((snap) => ({ ...snap }));
    if (!hasTargetOverlay || !targetId) return base;

    // Merge target data by closest timestamp
    const targetData = targetMetricsHistory[targetId] ?? [];
    if (targetData.length === 0) return base;

    const targetKey = tab === 'cpu' ? TARGET_DATA_KEYS.cpu : TARGET_DATA_KEYS.memory;
    const targetField = tab === 'cpu' ? 'cpuPercent' : 'memPercent';
    const targetMap = new Map(targetData.map((t) => [t.timestamp, t[targetField]]));

    return base.map((point) => {
      const exact = targetMap.get(point.timestamp);
      if (exact !== undefined) {
        return { ...point, [targetKey]: exact };
      }
      // Find closest target point within 3s
      let closest: number | undefined;
      let minDelta = Infinity;
      for (const [ts, val] of targetMap) {
        const delta = Math.abs(ts - point.timestamp);
        if (delta < minDelta && delta < 3000) {
          minDelta = delta;
          closest = val;
        }
      }
      return closest !== undefined ? { ...point, [targetKey]: closest } : point;
    });
  }, [metricsHistory, targetMetricsHistory, targetId, hasTargetOverlay, tab]);

  // Latest values for live indicator
  const latest = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const axisColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';

  const targetKey = tab === 'cpu' ? TARGET_DATA_KEYS.cpu : TARGET_DATA_KEYS.memory;
  const targetLabel = targetName ? `${targetName} ${tab === 'cpu' ? 'CPU' : 'Mem'}` : `Target ${tab === 'cpu' ? 'CPU' : 'Mem'}`;

  return (
    <div style={{ padding: '16px 0' }}>
      {/* Chart */}
      <div style={{ width: '100%', height: compact ? 180 : 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} syncId={syncId} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
                if (name === targetKey) {
                  return [config.formatter(value as number), targetLabel];
                }
                const s = config.series.find((s) => s.dataKey === name);
                const label = hasTargetOverlay ? `System ${s?.label ?? name}` : (s?.label ?? name);
                return [config.formatter(value as number), label];
              }}
            />
            {config.series.map((s) => (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                stroke={s.color}
                fill={s.color}
                fillOpacity={hasTargetOverlay ? 0.06 : 0.12}
                strokeWidth={hasTargetOverlay ? 1 : 2}
                strokeOpacity={hasTargetOverlay ? 0.4 : 1}
                dot={false}
                isAnimationActive={false}
              />
            ))}
            {hasTargetOverlay && (
              <Area
                type="monotone"
                dataKey={targetKey}
                stroke={TARGET_OVERLAY_COLOR}
                fill="none"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
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
          flexWrap: 'wrap',
        }}>
          {config.series.map((s) => (
            <div key={s.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: s.color,
                boxShadow: `0 0 6px ${s.color}`,
                opacity: hasTargetOverlay ? 0.4 : 1,
              }} />
              <span style={{ color: theme.palette.text.secondary }}>
                {hasTargetOverlay ? `System ${s.label}` : s.label}
              </span>
              <span style={{ color: theme.palette.text.primary, fontWeight: 600 }}>
                {config.formatter(latest[s.dataKey] as number)}
              </span>
            </div>
          ))}
          {hasTargetOverlay && (latest as Record<string, number>)[targetKey] !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: TARGET_OVERLAY_COLOR,
                boxShadow: `0 0 6px ${TARGET_OVERLAY_COLOR}`,
              }} />
              <span style={{ color: theme.palette.text.secondary }}>{targetLabel}</span>
              <span style={{ color: theme.palette.text.primary, fontWeight: 600 }}>
                {config.formatter((latest as Record<string, number>)[targetKey] ?? 0)}
              </span>
            </div>
          )}
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
  const loaded = snap.metricsLoaded;

  // Target selection state
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const { targets } = useSnapshot(targetsStore);
  const activeTargets = useMemo(
    () => targets.filter((t) => t.shielded && t.running),
    [targets],
  );
  const selectedTarget = activeTargets.find((t) => t.id === selectedTargetId);

  // Clear selection if target is no longer active
  useEffect(() => {
    if (selectedTargetId && !activeTargets.some((t) => t.id === selectedTargetId)) {
      setSelectedTargetId(null);
    }
  }, [activeTargets, selectedTargetId]);

  // Backfill target metrics history when a target is selected
  const { data: targetHistoryData } = useTargetMetricsHistory(selectedTargetId);

  // Backfill target metrics from REST into the valtio store
  useEffect(() => {
    if (!targetHistoryData || !selectedTargetId || targetHistoryData.length === 0) return;
    const existing = systemStore.targetMetricsHistory[selectedTargetId] ?? [];
    const existingTs = new Set(existing.map((s) => s.timestamp));
    const newSnaps = targetHistoryData.filter((s) => !existingTs.has(s.timestamp));
    if (newSnaps.length > 0) {
      for (const s of newSnaps) {
        pushTargetMetricsSnapshot(selectedTargetId, {
          timestamp: s.timestamp,
          cpuPercent: s.cpuPercent,
          memPercent: s.memPercent,
        });
      }
    }
  }, [targetHistoryData, selectedTargetId]);

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

      {/* Target filter row */}
      {activeTargets.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <span style={{
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', monospace",
            color: isDark ? pcb.silk.dim : pcb.light.silkDim,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginRight: 4,
          }}>
            Filter:
          </span>
          <TargetChip
            label="System"
            active={selectedTargetId === null}
            isDark={isDark}
            onClick={() => setSelectedTargetId(null)}
          />
          {activeTargets.map((t) => (
            <TargetChip
              key={t.id}
              label={t.name}
              active={selectedTargetId === t.id}
              isDark={isDark}
              accentColor={TARGET_OVERLAY_COLOR}
              onClick={() => setSelectedTargetId(selectedTargetId === t.id ? null : t.id)}
            />
          ))}
        </div>
      )}

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
              <CoreMetricsView
                tab={tab}
                compact
                syncId="system-metrics"
                targetId={selectedTargetId}
                targetName={selectedTarget?.name}
              />
            </div>
          );
        })}
        <EventLoopChart />
      </div>
    </div>
  );
}

/* ---- Event Loop chart ---- */

function EventLoopChart() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { eventLoopHistory } = useSnapshot(systemStore);

  const chartData = useMemo(() => eventLoopHistory.map((s) => ({ ...s })), [eventLoopHistory]);
  const latest = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const axisColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
  const accent = pcb.component.ledAmber;

  return (
    <div style={{
      gridColumn: '1 / -1',
      borderRadius: 6,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
      background: isDark ? pcb.component.body : pcb.light.body,
      overflow: 'hidden',
    }}>
      {/* Header */}
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
            background: accent,
            boxShadow: `0 0 4px ${accent}`,
          }} />
          <span style={{
            fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600,
            color: accent,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}>
            Event Loop
          </span>
        </div>
        {latest && (
          <span style={{
            fontSize: 12,
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600,
            color: isDark ? pcb.silk.primary : pcb.light.silk,
          }}>
            p99: {latest.p99.toFixed(1)}ms
          </span>
        )}
      </div>

      {/* Chart */}
      <div style={{ width: '100%', height: 180, padding: '16px 0' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} syncId="system-metrics" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTime}
              tick={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", fill: axisColor }}
              stroke={gridColor}
              minTickGap={40}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", fill: axisColor }}
              stroke={gridColor}
              width={52}
              tickFormatter={(v: number) => `${v}ms`}
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
                return [`${(value as number).toFixed(2)}ms`, name];
              }}
            />
            <ReferenceLine y={50} stroke={pcb.component.ledAmber} strokeDasharray="6 4" strokeOpacity={0.6} />
            <ReferenceLine y={200} stroke="#E1583E" strokeDasharray="6 4" strokeOpacity={0.6} />
            <Area
              type="monotone"
              dataKey="p50"
              name="p50"
              stroke={pcb.signal.cyan}
              fill={pcb.signal.cyan}
              fillOpacity={0.12}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="p99"
              name="p99"
              stroke={pcb.component.ledAmber}
              fill="none"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="mean"
              name="mean"
              stroke={pcb.trace.silver}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Live legend row */}
      {latest && (
        <div style={{
          display: 'flex',
          gap: 24,
          padding: '0 16px 12px',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: pcb.component.ledAmber,
              boxShadow: `0 0 6px ${pcb.component.ledAmber}`,
            }} />
            <span style={{ color: theme.palette.text.secondary }}>p99</span>
            <span style={{ color: theme.palette.text.primary, fontWeight: 600 }}>{latest.p99.toFixed(1)}ms</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: pcb.signal.cyan,
              boxShadow: `0 0 6px ${pcb.signal.cyan}`,
            }} />
            <span style={{ color: theme.palette.text.secondary }}>p50</span>
            <span style={{ color: theme.palette.text.primary, fontWeight: 600 }}>{latest.p50.toFixed(1)}ms</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: pcb.trace.silver,
              boxShadow: `0 0 6px ${pcb.trace.silver}`,
            }} />
            <span style={{ color: theme.palette.text.secondary }}>mean</span>
            <span style={{ color: theme.palette.text.primary, fontWeight: 600 }}>{latest.mean.toFixed(1)}ms</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {chartData.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: 20,
          color: theme.palette.text.secondary,
          fontFamily: "'Manrope', sans-serif",
          fontSize: 14,
        }}>
          Waiting for event loop data...
        </div>
      )}
    </div>
  );
}

/* ---- Target filter chip ---- */

interface TargetChipProps {
  label: string;
  active: boolean;
  isDark: boolean;
  accentColor?: string;
  onClick: () => void;
}

function TargetChip({ label, active, isDark, accentColor, onClick }: TargetChipProps) {
  const bgActive = accentColor
    ? `${accentColor}22`
    : isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const bgHover = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 12,
        border: `1px solid ${active
          ? (accentColor ?? (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'))
          : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)')}`,
        background: active ? bgActive : 'transparent',
        cursor: 'pointer',
        fontSize: 11,
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: active ? 600 : 400,
        color: active
          ? (accentColor ?? (isDark ? pcb.silk.primary : pcb.light.silk))
          : (isDark ? pcb.silk.dim : pcb.light.silkDim),
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = bgHover;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      {accentColor && (
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: accentColor,
          opacity: active ? 1 : 0.4,
        }} />
      )}
      {label}
    </button>
  );
}
