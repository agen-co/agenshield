/**
 * Skills variant — QFP chip with lightning bolt cluster icon.
 *
 * Subscribes only to `systemStore.components.skills`.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder, StatusBadgeRow } from '../primitives';
import type { VariantProps } from '../system.types';

export const SkillsChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const { active, health, okCount, warnCount, dangerCount } = snap.components.skills;
  const isDanger = health === 'danger';

  const { body } = layout;
  const { silkDim, silkColor, chipBody } = theme;
  const chipBorder = health === 'danger' ? '#E1583E'
    : health === 'warn' ? '#E8B84A'
    : theme.chipBorder;

  const borderRef = useExposedBorder(isDanger);

  // Lightning bolt cluster center
  const cx = body.x + body.w * 0.5;
  const cy = body.y + body.h * 0.5;

  return (
    <g>
      {/* Chip body */}
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />

      {/* Lightning bolt cluster — 3 small zap shapes */}
      <g opacity={0.35}>
        {/* Center bolt (larger) */}
        <path
          d={`M ${cx - 3} ${cy - 10} L ${cx - 1} ${cy - 1} L ${cx + 3} ${cy - 1} L ${cx + 1} ${cy + 10} L ${cx + 3} ${cy + 1} L ${cx - 1} ${cy + 1} Z`}
          fill={silkDim} stroke="none"
        />
        {/* Left bolt (smaller) */}
        <path
          d={`M ${cx - 12} ${cy - 6} L ${cx - 10} ${cy - 0.5} L ${cx - 8} ${cy - 0.5} L ${cx - 9} ${cy + 6} L ${cx - 7} ${cy + 0.5} L ${cx - 10} ${cy + 0.5} Z`}
          fill={silkDim} stroke="none"
        />
        {/* Right bolt (smaller) */}
        <path
          d={`M ${cx + 8} ${cy - 6} L ${cx + 10} ${cy - 0.5} L ${cx + 12} ${cy - 0.5} L ${cx + 11} ${cy + 6} L ${cx + 13} ${cy + 0.5} L ${cx + 10} ${cy + 0.5} Z`}
          fill={silkDim} stroke="none"
        />
      </g>

      {/* TOOLS label */}
      <text x={body.x + body.w / 2} y={cy + 18}
        textAnchor="middle" dominantBaseline="central"
        fill={silkDim} fontSize={4} fontFamily="'IBM Plex Mono', monospace"
        letterSpacing={1} opacity={0.4}>
        {active ? 'ACTIVE' : 'IDLE'}
      </text>

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
        active={active} exposed={isDanger} silkDim={silkDim} />

      {/* Alert indicator */}
      <AlertIndicator x={body.x + body.w - 20} y={body.y + body.h - 22}
        exposed={isDanger} silkDim={silkDim} />

      {/* Exposed border */}
      {isDanger && (
        <rect ref={borderRef} x={body.x - 1} y={body.y - 1}
          width={body.w + 2} height={body.h + 2}
          fill="none" stroke="#E1583E" strokeWidth={1.2} rx={3}
          opacity={0.3} style={{ willChange: 'opacity' }} />
      )}
    </g>
  );
});
SkillsChip.displayName = 'SkillsChip';
