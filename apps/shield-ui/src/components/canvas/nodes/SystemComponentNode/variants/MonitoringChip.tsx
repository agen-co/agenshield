/**
 * Monitoring variant — QFP chip with bar chart and test probes.
 * Bar heights reflect actual CPU, memory, disk, and network usage.
 *
 * Subscribes to `systemStore.metrics` and `systemStore.components.monitoring`.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder, gaugeColor, StatusBadgeRow } from '../primitives';
import type { VariantProps } from '../system.types';

export const MonitoringChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const { cpuPercent, memPercent, diskPercent, netUp, netDown } = snap.metrics;
  const { exposed, active, health, okCount, warnCount, dangerCount } = snap.components.monitoring;

  const { body } = layout;
  const { padColor, silkDim, silkColor, chipBody } = theme;
  const chipBorder = exposed ? '#E1583E'
    : health === 'danger' ? '#E1583E'
    : health === 'warn' ? '#E8B84A'
    : theme.chipBorder;

  const borderRef = useExposedBorder(exposed);

  // Bar chart — heights driven by real system metrics
  const barX = body.x + body.w * 0.2;
  const barBaseY = body.y + body.h * 0.78;
  const barW = 4;
  const NET_MAX = 10 * 1024 * 1024; // 10 MB/s ceiling
  const barHeights = [
    cpuPercent / 100,
    memPercent / 100,
    diskPercent / 100,
    Math.min(1, netUp / NET_MAX),
    Math.min(1, netDown / NET_MAX),
    (cpuPercent + memPercent + diskPercent) / 300,
  ].map((v) => Math.max(0.05, Math.min(1, Number.isFinite(v) ? v : 0)));

  return (
    <g>
      {/* Chip body */}
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />

      {/* Bar chart */}
      <g>
        {barHeights.map((height, i) => {
          const barColor = gaugeColor(height * 100);
          return (
            <rect key={`bar-${i}`}
              x={barX + i * (barW + 2.5)} y={barBaseY - body.h * 0.5 * height}
              width={barW} height={body.h * 0.5 * height}
              fill={barColor} opacity={0.5} rx={0.3} />
          );
        })}
        <line x1={barX - 2} y1={barBaseY} x2={barX + 6 * (barW + 2.5)} y2={barBaseY}
          stroke={silkDim} strokeWidth={0.5} opacity={0.3} />
        <line x1={barX - 2} y1={barBaseY} x2={barX - 2} y2={barBaseY - body.h * 0.45}
          stroke={silkDim} strokeWidth={0.4} opacity={0.3} />
      </g>

      {/* Test probe points */}
      <g opacity={0.35}>
        <circle cx={body.x + 5} cy={body.y + body.h - 5} r={2.5}
          fill="none" stroke={padColor} strokeWidth={0.6} />
        <circle cx={body.x + 5} cy={body.y + body.h - 5} r={1} fill={padColor} />
        <text x={body.x + 5} y={body.y + body.h - 10} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={2.5} fontFamily="'IBM Plex Mono', monospace">TP1</text>
        <circle cx={body.x + body.w - 5} cy={body.y + body.h - 5} r={2.5}
          fill="none" stroke={padColor} strokeWidth={0.6} />
        <circle cx={body.x + body.w - 5} cy={body.y + body.h - 5} r={1} fill={padColor} />
        <text x={body.x + body.w - 5} y={body.y + body.h - 10} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={2.5} fontFamily="'IBM Plex Mono', monospace">TP2</text>
      </g>

      {/* Pin-1 dot */}
      <circle cx={body.x + 6} cy={body.y + 6} r={2} fill={silkDim} opacity={0.5} />

      {/* Label — inside body */}
      <text x={body.x + 8} y={body.y + 8} textAnchor="start" dominantBaseline="hanging"
        fill={silkColor} fontSize={11} fontFamily="'IBM Plex Mono', monospace"
        fontWeight={700} letterSpacing={1}>{label}</text>
      <text x={body.x + 8} y={body.y + 22} textAnchor="start" dominantBaseline="hanging"
        fill={silkDim} fontSize={6} fontFamily="'IBM Plex Mono', monospace"
        letterSpacing={0.3}>{sublabel}</text>

      {/* Health stat badges */}
      <StatusBadgeRow
        x={body.x + body.w / 2}
        y={body.y + body.h - 18}
        ok={okCount} warn={warnCount} danger={dangerCount}
        silkDim={silkDim}
      />

      {/* Ref designator */}
      <text x={body.x + 6} y={body.y + body.h - 6} textAnchor="start" dominantBaseline="auto"
        fill={silkDim} fontSize={5} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.5}>{refDesignator}</text>

      {/* Status LED */}
      <StatusLed x={body.x + body.w - 20} y={body.y + 14}
        active={active} exposed={exposed} silkDim={silkDim} />

      {/* Alert indicator */}
      <AlertIndicator x={body.x + body.w - 20} y={body.y + body.h - 22}
        exposed={exposed} silkDim={silkDim} />

      {/* Exposed border */}
      {exposed && (
        <rect ref={borderRef} x={body.x - 1} y={body.y - 1}
          width={body.w + 2} height={body.h + 2}
          fill="none" stroke="#E1583E" strokeWidth={1.2} rx={3}
          opacity={0.3} style={{ willChange: 'opacity' }} />
      )}
    </g>
  );
});
MonitoringChip.displayName = 'MonitoringChip';
