/**
 * Secrets variant — QFP chip with shield/lock icon and encrypted status.
 *
 * Subscribes only to `systemStore.components.secrets`.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder, StatusBadgeRow } from '../primitives';
import type { VariantProps } from '../system.types';

export const SecretsChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const { exposed, active, health, okCount, warnCount, dangerCount } = snap.components.secrets;

  const { body } = layout;
  const { padColor, silkDim, silkColor, chipBody } = theme;
  const chipBorder = exposed ? '#E1583E'
    : health === 'danger' ? '#E1583E'
    : health === 'warn' ? '#E8B84A'
    : theme.chipBorder;

  const borderRef = useExposedBorder(exposed);

  // Lock icon geometry
  const lockCx = body.x + body.w * 0.5;
  const lockCy = body.y + body.h * 0.52;
  const lockW = 18;
  const lockH = 14;

  return (
    <g>
      {/* Chip body */}
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />

      {/* Lock icon (simplified SVG) */}
      <g opacity={0.35}>
        {/* Lock body */}
        <rect x={lockCx - lockW / 2} y={lockCy} width={lockW} height={lockH}
          fill="none" stroke={silkDim} strokeWidth={1} rx={2} />
        {/* Lock shackle */}
        <path
          d={`M ${lockCx - 5} ${lockCy} V ${lockCy - 6} A 5 5 0 0 1 ${lockCx + 5} ${lockCy - 6} V ${lockCy}`}
          fill="none" stroke={silkDim} strokeWidth={1} />
        {/* Keyhole */}
        <circle cx={lockCx} cy={lockCy + lockH * 0.4} r={2} fill={silkDim} />
        <rect x={lockCx - 0.8} y={lockCy + lockH * 0.4} width={1.6} height={4}
          fill={silkDim} rx={0.4} />
      </g>

      {/* ENCRYPTED / LOCKED label */}
      <text x={body.x + body.w / 2} y={lockCy + lockH + 10}
        textAnchor="middle" dominantBaseline="central"
        fill={silkDim} fontSize={4} fontFamily="'IBM Plex Mono', monospace"
        letterSpacing={1} opacity={0.4}>
        {active ? 'ENCRYPTED' : 'LOCKED'}
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
SecretsChip.displayName = 'SecretsChip';
