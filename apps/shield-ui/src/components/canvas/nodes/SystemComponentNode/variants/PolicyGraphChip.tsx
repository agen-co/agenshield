/**
 * PolicyGraph variant — QFP chip with decision tree icon.
 *
 * Subscribes only to `systemStore.components['policy-graph']`.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder, StatusBadgeRow } from '../primitives';
import type { VariantProps } from '../system.types';

export const PolicyGraphChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const { active, health, okCount, warnCount, dangerCount } = snap.components['policy-graph'];
  const isDanger = health === 'danger';

  const { body } = layout;
  const { silkDim, silkColor, chipBody } = theme;
  const chipBorder = health === 'danger' ? '#E1583E'
    : health === 'warn' ? '#E8B84A'
    : theme.chipBorder;

  const borderRef = useExposedBorder(isDanger);

  // Decision tree geometry
  const treeX = body.x + body.w * 0.5;
  const treeY = body.y + body.h * 0.42;
  const nodeR = 3;

  return (
    <g>
      {/* Chip body */}
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />

      {/* Decision tree icon */}
      <g opacity={0.35}>
        {/* Root node */}
        <circle cx={treeX} cy={treeY - 12} r={nodeR} fill="none" stroke={silkDim} strokeWidth={0.8} />
        {/* Left branch */}
        <line x1={treeX} y1={treeY - 12 + nodeR} x2={treeX - 14} y2={treeY + 2}
          stroke={silkDim} strokeWidth={0.6} />
        <circle cx={treeX - 14} cy={treeY + 2} r={nodeR} fill="none" stroke={silkDim} strokeWidth={0.8} />
        {/* Right branch */}
        <line x1={treeX} y1={treeY - 12 + nodeR} x2={treeX + 14} y2={treeY + 2}
          stroke={silkDim} strokeWidth={0.6} />
        <circle cx={treeX + 14} cy={treeY + 2} r={nodeR} fill="none" stroke={silkDim} strokeWidth={0.8} />
        {/* Left-left leaf */}
        <line x1={treeX - 14} y1={treeY + 2 + nodeR} x2={treeX - 22} y2={treeY + 16}
          stroke={silkDim} strokeWidth={0.6} />
        <rect x={treeX - 25} y={treeY + 14} width={6} height={4}
          fill="none" stroke={silkDim} strokeWidth={0.6} rx={0.5} />
        {/* Left-right leaf */}
        <line x1={treeX - 14} y1={treeY + 2 + nodeR} x2={treeX - 6} y2={treeY + 16}
          stroke={silkDim} strokeWidth={0.6} />
        <rect x={treeX - 9} y={treeY + 14} width={6} height={4}
          fill="none" stroke={silkDim} strokeWidth={0.6} rx={0.5} />
        {/* Right-left leaf */}
        <line x1={treeX + 14} y1={treeY + 2 + nodeR} x2={treeX + 6} y2={treeY + 16}
          stroke={silkDim} strokeWidth={0.6} />
        <rect x={treeX + 3} y={treeY + 14} width={6} height={4}
          fill="none" stroke={silkDim} strokeWidth={0.6} rx={0.5} />
        {/* Right-right leaf */}
        <line x1={treeX + 14} y1={treeY + 2 + nodeR} x2={treeX + 22} y2={treeY + 16}
          stroke={silkDim} strokeWidth={0.6} />
        <rect x={treeX + 19} y={treeY + 14} width={6} height={4}
          fill="none" stroke={silkDim} strokeWidth={0.6} rx={0.5} />
      </g>

      {/* RULES label */}
      <text x={body.x + body.w / 2} y={treeY + 28}
        textAnchor="middle" dominantBaseline="central"
        fill={silkDim} fontSize={4} fontFamily="'IBM Plex Mono', monospace"
        letterSpacing={1} opacity={0.4}>
        RULES
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
PolicyGraphChip.displayName = 'PolicyGraphChip';
