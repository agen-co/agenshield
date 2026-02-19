/**
 * Filesystem variant — drive module with platter, actuator, SATA-L connector.
 * Arc gauge around platter shows disk usage.
 *
 * Subscribes only to `systemStore.metrics.diskPercent` and `systemStore.components.filesystem`.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder, gaugeColor } from '../primitives';
import type { VariantProps } from '../system.types';

export const FilesystemChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const diskPercent = snap.metrics.diskPercent;
  const { exposed, active } = snap.components.filesystem;

  const { body } = layout;
  const { silkDim, silkColor, chipBody } = theme;
  const chipBorder = exposed ? '#E1583E' : theme.chipBorder;

  const borderRef = useExposedBorder(exposed);

  // Mounting holes
  const holes = [
    { x: body.x + 6, y: body.y + 6 }, { x: body.x + body.w - 6, y: body.y + 6 },
    { x: body.x + 6, y: body.y + body.h - 6 }, { x: body.x + body.w - 6, y: body.y + body.h - 6 },
  ].map((p, i) => (
    <g key={`mh-${i}`}>
      <circle cx={p.x} cy={p.y} r={2.5} fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.35} />
      <circle cx={p.x} cy={p.y} r={1} fill={silkDim} opacity={0.15} />
    </g>
  ));

  // Platter
  const platCx = body.x + body.w * 0.38;
  const platCy = body.y + body.h * 0.48;
  const platR = Math.min(body.w, body.h) * 0.3;

  // Arc gauge
  const arcAngle = (diskPercent / 100) * 270;
  const startAngle = 135;
  const endAngle = startAngle + arcAngle;
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;
  const arcR = platR + 3;
  const x1 = platCx + arcR * Math.cos(startRad);
  const y1 = platCy + arcR * Math.sin(startRad);
  const x2 = platCx + arcR * Math.cos(endRad);
  const y2 = platCy + arcR * Math.sin(endRad);
  const largeArc = arcAngle > 180 ? 1 : 0;
  const diskColor = gaugeColor(diskPercent);

  return (
    <g>
      {/* Chip body */}
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.3} />
      {holes}

      {/* Platter rings */}
      <circle cx={platCx} cy={platCy} r={platR}
        fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.2} />
      <circle cx={platCx} cy={platCy} r={platR * 0.65}
        fill="none" stroke={silkDim} strokeWidth={0.3} opacity={0.15} />
      <circle cx={platCx} cy={platCy} r={platR * 0.3}
        fill="none" stroke={silkDim} strokeWidth={0.3} opacity={0.12} />
      <circle cx={platCx} cy={platCy} r={platR * 0.1}
        fill={silkDim} opacity={0.15} />

      {/* Arc gauge around platter */}
      {arcAngle > 0 && (
        <path
          d={`M ${x1} ${y1} A ${arcR} ${arcR} 0 ${largeArc} 1 ${x2} ${y2}`}
          fill="none" stroke={diskColor} strokeWidth={2} opacity={0.6}
          strokeLinecap="round" />
      )}
      {/* Disk % text */}
      <text x={platCx} y={platCy + 1} textAnchor="middle" dominantBaseline="central"
        fill={diskColor} fontSize={4.5} fontFamily="'IBM Plex Mono', monospace"
        fontWeight={700} opacity={0.7}>
        {Math.round(diskPercent)}%
      </text>

      {/* Actuator arm */}
      <line x1={body.x + body.w * 0.78} y1={body.y + body.h * 0.82}
        x2={platCx + platR * 0.2} y2={platCy - platR * 0.2}
        stroke={silkDim} strokeWidth={0.8} opacity={0.2} />
      <circle cx={body.x + body.w * 0.78} cy={body.y + body.h * 0.82} r={2.5}
        fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.2} />
      {/* Read head */}
      <rect x={platCx + platR * 0.1} y={platCy - platR * 0.3}
        width={4} height={2} fill={silkDim} opacity={0.15} rx={0.5} />

      {/* Label — inside body */}
      <text x={body.x + 8} y={body.y + 8} textAnchor="start" dominantBaseline="hanging"
        fill={silkColor} fontSize={11} fontFamily="'IBM Plex Mono', monospace"
        fontWeight={700} letterSpacing={1}>{label}</text>
      <text x={body.x + 8} y={body.y + 22} textAnchor="start" dominantBaseline="hanging"
        fill={silkDim} fontSize={6} fontFamily="'IBM Plex Mono', monospace"
        letterSpacing={0.3}>{sublabel}</text>

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
FilesystemChip.displayName = 'FilesystemChip';
