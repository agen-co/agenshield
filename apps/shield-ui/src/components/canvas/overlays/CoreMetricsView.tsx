/**
 * CoreMetricsView — recharts-based real-time metrics chart for the 4 core system components.
 *
 * Receives a `tab` prop ('cpu' | 'memory' | 'disk' | 'network') and renders
 * an AreaChart from the rolling metricsHistory buffer in systemStore.
 *
 * When `targets` are provided, CPU/Memory charts show each shielded target
 * as a separate colored series overlaid on the system metrics.
 * Percentage-based charts (cpu, memory, disk) use auto-scaled Y-axis with
 * ±10% padding around the visible data range, clamped to [0, 100].
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
  yDomainMode: 'padded' | 'auto';
  formatter: (v: number) => string;
  unit: string;
}

const TAB_CONFIG: Record<MetricsTab, TabConfig> = {
  cpu: {
    series: [{ dataKey: 'cpuPercent', label: 'CPU', color: pcb.component.ledGreen }],
    yDomainMode: 'padded',
    formatter: (v) => `${v.toFixed(1)}%`,
    unit: '%',
  },
  memory: {
    series: [{ dataKey: 'memPercent', label: 'Memory', color: pcb.signal.cyan }],
    yDomainMode: 'padded',
    formatter: (v) => `${v.toFixed(1)}%`,
    unit: '%',
  },
  disk: {
    series: [{ dataKey: 'diskPercent', label: 'Disk', color: pcb.component.ledAmber }],
    yDomainMode: 'padded',
    formatter: (v) => `${v.toFixed(1)}%`,
    unit: '%',
  },
  network: {
    series: [
      { dataKey: 'netUp', label: 'Upload', color: pcb.component.ledGreen },
      { dataKey: 'netDown', label: 'Download', color: pcb.signal.cyan },
    ],
    yDomainMode: 'auto',
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

export interface TargetOverlayEntry {
  id: string;
  name: string;
}

const TARGET_COLORS = ['#FF6B6B', '#6BAEF2', '#EEA45F', '#6CB685', '#FFDF5E'];

interface CoreMetricsViewProps {
  tab: MetricsTab;
  compact?: boolean;
  syncId?: string;
  targets?: TargetOverlayEntry[];
}

export default function CoreMetricsView({ tab, compact, syncId, targets }: CoreMetricsViewProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { metricsHistory, targetMetricsHistory } = useSnapshot(systemStore);

  const config = TAB_CONFIG[tab];
  const visibleTargets = targets && targets.length > 0 && (tab === 'cpu' || tab === 'memory') ? targets : [];
  const hasTargetOverlay = visibleTargets.length > 0;

  const chartData = useMemo(() => {
    const base = metricsHistory.map((snap) => ({ ...snap }));
    if (!hasTargetOverlay) return base;

    const targetField = tab === 'cpu' ? 'cpuPercent' : 'memPercent';

    // Build timestamp maps for each target
    const targetMaps = new Map<string, Map<number, number>>();
    for (const t of visibleTargets) {
      const history = targetMetricsHistory[t.id] ?? [];
      if (history.length > 0) {
        targetMaps.set(t.id, new Map(history.map((s) => [s.timestamp, s[targetField]])));
      }
    }

    if (targetMaps.size === 0) return base;

    return base.map((point) => {
      const merged: Record<string, unknown> = { ...point };
      for (const [targetId, tMap] of targetMaps) {
        const exact = tMap.get(point.timestamp);
        if (exact !== undefined) {
          merged[`target_${targetId}`] = exact;
          continue;
        }
        // Find closest target point within 3s
        let closest: number | undefined;
        let minDelta = Infinity;
        for (const [ts, val] of tMap) {
          const delta = Math.abs(ts - point.timestamp);
          if (delta < minDelta && delta < 3000) {
            minDelta = delta;
            closest = val;
          }
        }
        if (closest !== undefined) {
          merged[`target_${targetId}`] = closest;
        }
      }
      return merged;
    });
  }, [metricsHistory, targetMetricsHistory, visibleTargets, hasTargetOverlay, tab]);

  // Auto-scaled Y-axis with ±10% padding for percentage metrics
  const yDomain = useMemo<[number, number] | ['auto', 'auto']>(() => {
    if (config.yDomainMode === 'auto') return ['auto', 'auto'];
    if (chartData.length === 0) return [0, 100];

    // Gather all data keys we need to inspect
    const allKeys: string[] = config.series.map((s) => s.dataKey as string);
    for (const t of visibleTargets) {
      allKeys.push(`target_${t.id}`);
    }

    let min = Infinity;
    let max = -Infinity;
    for (const point of chartData) {
      for (const key of allKeys) {
        const val = (point as Record<string, number>)[key];
        if (val !== undefined && val !== null && isFinite(val)) {
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
    }

    if (!isFinite(min) || !isFinite(max)) return [0, 100];

    const range = max - min;
    const padding = Math.max(range * 0.1, 2);
    const lo = Math.max(0, Math.floor(min - padding));
    const hi = Math.min(100, Math.ceil(max + padding));
    return [lo, hi];
  }, [chartData, config, visibleTargets]);

  // Latest values for live indicator
  const latest = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const axisColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';

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
              domain={yDomain}
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
                // Target series keys are prefixed with "target_"
                if (typeof name === 'string' && name.startsWith('target_')) {
                  const targetId = name.slice('target_'.length);
                  const target = visibleTargets.find((t) => t.id === targetId);
                  const label = target
                    ? `${target.name} ${tab === 'cpu' ? 'CPU' : 'Mem'}`
                    : name;
                  return [config.formatter(value as number), label];
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
            {visibleTargets.map((t, i) => (
              <Area
                key={`target_${t.id}`}
                type="monotone"
                dataKey={`target_${t.id}`}
                stroke={TARGET_COLORS[i % TARGET_COLORS.length]}
                fill="none"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
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
          {visibleTargets.map((t, i) => {
            const val = (latest as Record<string, number>)[`target_${t.id}`];
            if (val === undefined) return null;
            const color = TARGET_COLORS[i % TARGET_COLORS.length];
            return (
              <div key={`target_${t.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: color,
                  boxShadow: `0 0 6px ${color}`,
                }} />
                <span style={{ color: theme.palette.text.secondary }}>
                  {t.name} {tab === 'cpu' ? 'CPU' : 'Mem'}
                </span>
                <span style={{ color: theme.palette.text.primary, fontWeight: 600 }}>
                  {config.formatter(val)}
                </span>
              </div>
            );
          })}
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

/* ---- Backfill helper: fetches target metrics history via REST ---- */

function TargetMetricsBackfill({ targetId }: { targetId: string }) {
  const { data } = useTargetMetricsHistory(targetId);

  useEffect(() => {
    if (!data || data.length === 0) return;
    const existing = systemStore.targetMetricsHistory[targetId] ?? [];
    const existingTs = new Set(existing.map((s) => s.timestamp));
    const newSnaps = data.filter((s) => !existingTs.has(s.timestamp));
    if (newSnaps.length > 0) {
      for (const s of newSnaps) {
        pushTargetMetricsSnapshot(targetId, {
          timestamp: s.timestamp,
          cpuPercent: s.cpuPercent,
          memPercent: s.memPercent,
        });
      }
    }
  }, [data, targetId]);

  return null;
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

  const { targets } = useSnapshot(targetsStore);
  const activeTargets = useMemo(
    () => targets.filter((t) => t.shielded && t.running),
    [targets],
  );

  // Build overlay entries for CoreMetricsView
  const targetOverlays: TargetOverlayEntry[] = useMemo(
    () => activeTargets.map((t) => ({ id: t.id, name: t.name })),
    [activeTargets],
  );

  return (
    <div style={{ padding: '8px 16px 16px' }}>
      {/* Backfill target metrics for all active targets */}
      {activeTargets.map((t) => (
        <TargetMetricsBackfill key={t.id} targetId={t.id} />
      ))}

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
              <CoreMetricsView
                tab={tab}
                compact
                syncId="system-metrics"
                targets={targetOverlays}
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
