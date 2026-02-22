/**
 * StatusBadgeRow — 3 small stat badges (green / orange / red) rendered
 * as an SVG group. Non-zero counts are vivid; zero counts are dimmed.
 */

import { memo } from 'react';

interface StatusBadgeRowProps {
  /** Left edge of the badge row */
  x: number;
  /** Vertical center of the badge row */
  y: number;
  ok: number;
  warn: number;
  danger: number;
  /** Silk dim color for zero-count labels */
  silkDim: string;
}

const BADGE_W = 18;
const BADGE_H = 10;
const BADGE_GAP = 3;
const BADGE_R = 2;
const FONT = "'IBM Plex Mono', monospace";

interface BadgeProps {
  x: number;
  y: number;
  count: number;
  color: string;
  silkDim: string;
}

function Badge({ x, y, count, color, silkDim }: BadgeProps) {
  const active = count > 0;
  return (
    <g>
      <rect
        x={x}
        y={y - BADGE_H / 2}
        width={BADGE_W}
        height={BADGE_H}
        rx={BADGE_R}
        fill={active ? color : silkDim}
        opacity={active ? 0.2 : 0.1}
      />
      <text
        x={x + BADGE_W / 2}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={active ? color : silkDim}
        fontSize={6}
        fontFamily={FONT}
        fontWeight={600}
        opacity={active ? 1 : 0.4}
      >
        {count}
      </text>
    </g>
  );
}

export const StatusBadgeRow = memo(({ x, y, ok, warn, danger, silkDim }: StatusBadgeRowProps) => {
  const totalW = BADGE_W * 3 + BADGE_GAP * 2;
  const startX = x - totalW / 2;

  return (
    <g>
      <Badge x={startX} y={y} count={ok} color="#3DC75F" silkDim={silkDim} />
      <Badge x={startX + BADGE_W + BADGE_GAP} y={y} count={warn} color="#E8B84A" silkDim={silkDim} />
      <Badge x={startX + (BADGE_W + BADGE_GAP) * 2} y={y} count={danger} color="#E1583E" silkDim={silkDim} />
    </g>
  );
});
StatusBadgeRow.displayName = 'StatusBadgeRow';
