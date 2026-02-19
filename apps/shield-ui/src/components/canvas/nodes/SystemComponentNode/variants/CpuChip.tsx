/**
 * CPU variant — BGA square with heat sink fins, 6×8 dot grid, die outline.
 * Horizontal bar gauge shows live CPU usage.
 *
 * Subscribes only to `systemStore.metrics.cpuPercent` and `systemStore.components.cpu`.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder, gaugeColor } from '../primitives';
import type { VariantProps } from '../system.types';

export const CpuChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const cpuPercent = snap.metrics.cpuPercent;
  const { exposed, active } = snap.components.cpu;

  const { body } = layout;
  const { silkDim, silkColor, chipBody } = theme;
  const chipBorder = exposed ? '#E1583E' : theme.chipBorder;

  const borderRef = useExposedBorder(exposed);

  // Interior BGA dots (6×8)
  const dots: React.JSX.Element[] = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 8; col++) {
      dots.push(
        <circle key={`d-${row}-${col}`}
          cx={body.x + 10 + col * ((body.w - 20) / 7)}
          cy={body.y + 10 + row * ((body.h - 20) / 5)}
          r={1} fill={silkDim} opacity={0.2} />,
      );
    }
  }

  // Heat sink fins
  const finCount = 8;
  const fins: React.JSX.Element[] = [];
  for (let i = 0; i < finCount; i++) {
    const ly = body.y + 6 + i * ((body.h - 12) / (finCount - 1));
    fins.push(
      <line key={`fin-${i}`} x1={body.x + 4} y1={ly} x2={body.x + body.w - 4} y2={ly}
        stroke={silkDim} strokeWidth={0.4} opacity={0.12} />,
    );
  }

  // Die outline + thermal pad
  const dieW = body.w * 0.4;
  const dieH = body.h * 0.4;
  const dieCx = body.x + body.w / 2;
  const dieCy = body.y + body.h / 2;

  // CPU gauge bar
  const gaugeW = dieW - 8;
  const gaugeH = 7;
  const gaugeX = dieCx - gaugeW / 2;
  const gaugeY = dieCy + dieH * 0.1;
  const fillW = gaugeW * (cpuPercent / 100);
  const gColor = gaugeColor(cpuPercent);

  return (
    <g>
      {/* Chip body */}
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />
      {dots}
      {fins}

      {/* Die outline */}
      <rect x={dieCx - dieW / 2} y={dieCy - dieH / 2} width={dieW} height={dieH}
        fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.25} rx={1} />
      {/* Thermal pad */}
      <rect x={dieCx - dieW * 0.3} y={dieCy - dieH * 0.3} width={dieW * 0.6} height={dieH * 0.6}
        fill={silkDim} opacity={0.06} rx={0.5} />

      {/* CPU gauge bar */}
      <rect x={gaugeX} y={gaugeY} width={gaugeW} height={gaugeH}
        fill={silkDim} opacity={0.08} rx={1} />
      <rect x={gaugeX} y={gaugeY} width={fillW} height={gaugeH}
        fill={gColor} opacity={0.6} rx={1} />
      <text x={dieCx} y={gaugeY - 3} textAnchor="middle" dominantBaseline="auto"
        fill={gColor} fontSize={8} fontFamily="'IBM Plex Mono', monospace"
        fontWeight={700} opacity={0.8}>
        {Math.round(cpuPercent)}%
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

      {/* Ref designator — inside body, bottom-left */}
      <text x={body.x + 6} y={body.y + body.h - 6} textAnchor="start" dominantBaseline="auto"
        fill={silkDim} fontSize={5} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.5}>{refDesignator}</text>

      {/* Status LED */}
      <StatusLed x={body.x + body.w - 20} y={body.y + 14}
        active={active} exposed={exposed} silkDim={silkDim} />

      {/* Alert indicator */}
      <AlertIndicator x={body.x + body.w - 20} y={body.y + body.h - 22}
        exposed={exposed} silkDim={silkDim} />

      {/* Exposed border pulse */}
      {exposed && (
        <rect ref={borderRef} x={body.x - 1} y={body.y - 1}
          width={body.w + 2} height={body.h + 2}
          fill="none" stroke="#E1583E" strokeWidth={1.2} rx={3}
          opacity={0.3} style={{ willChange: 'opacity' }} />
      )}
    </g>
  );
});
CpuChip.displayName = 'CpuChip';
