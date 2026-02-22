/**
 * Memory variant — DIMM stick with chip-on-board modules, SPD, notch.
 * Modules glow proportionally to memory usage.
 *
 * Subscribes only to `systemStore.metrics.memPercent` and `systemStore.components.memory`.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder, gaugeColor, MiniSparkline } from '../primitives';
import type { VariantProps } from '../system.types';

export const MemoryChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const memPercent = snap.metrics.memPercent;
  const { exposed, active } = snap.components.memory;

  const { body } = layout;
  const { silkDim, silkColor, chipBody } = theme;
  const chipBorder = exposed ? '#E1583E' : theme.chipBorder;

  const borderRef = useExposedBorder<SVGPathElement>(exposed);

  // Notch in bottom edge
  const notchX = body.x + body.w / 2;

  // Module lighting based on memPercent
  const moduleCount = 8;
  const litModules = Math.ceil((memPercent / 100) * moduleCount);
  const memColor = gaugeColor(memPercent);

  return (
    <g>
      {/* DIMM body with notch */}
      <path
        d={`M ${body.x + 2} ${body.y}
            H ${body.x + body.w - 2}
            V ${body.y + body.h}
            H ${notchX + 7}
            V ${body.y + body.h + 6}
            H ${notchX - 7}
            V ${body.y + body.h}
            H ${body.x + 2}
            Z`}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6}
      />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={1} opacity={0.3} />

      {/* Chip-on-board modules (8) — lit proportionally */}
      {Array.from({ length: moduleCount }, (_, i) => {
        const chipW = (body.w - 16) / 8 - 2;
        const cx = body.x + 8 + i * ((body.w - 16) / 8);
        const isLit = i < litModules;
        return (
          <g key={`mc-${i}`}>
            <rect x={cx} y={body.y + 3} width={chipW} height={body.h - 6}
              fill={isLit ? memColor : silkDim} opacity={isLit ? 0.18 : 0.07} rx={0.8} />
            <rect x={cx + 0.5} y={body.y + 3.5} width={chipW - 1} height={body.h - 7}
              fill="none" stroke={isLit ? memColor : silkDim} strokeWidth={0.3}
              opacity={isLit ? 0.4 : 0.15} rx={0.5} />
            <circle cx={cx + 2} cy={body.y + 5} r={0.5} fill={silkDim} opacity={0.25} />
          </g>
        );
      })}

      {/* Sparkline background */}
      <MiniSparkline dataKey="memPercent"
        x={body.x + 8} y={body.y + 3}
        w={body.w - 16} h={body.h * 0.35}
        color={memColor} />

      {/* Memory % label */}
      <text x={body.x + body.w - 6} y={body.y + body.h - 3} textAnchor="end" dominantBaseline="auto"
        fill={memColor} fontSize={7} fontFamily="'IBM Plex Mono', monospace"
        fontWeight={700} opacity={0.7}>
        {Math.round(memPercent)}%
      </text>

      {/* SPD chip */}
      <rect x={body.x + body.w * 0.42} y={body.y + 2} width={8} height={5}
        fill={silkDim} opacity={0.06} rx={0.5} />
      <text x={body.x + body.w * 0.42 + 4} y={body.y + 4.5} textAnchor="middle" dominantBaseline="central"
        fill={silkDim} fontSize={2.5} fontFamily="'IBM Plex Mono', monospace" opacity={0.2}>SPD</text>

      {/* Latch clips */}
      <rect x={body.x - 1} y={body.y + body.h * 0.2} width={3} height={8}
        fill="none" stroke={silkDim} strokeWidth={0.4} opacity={0.25} rx={0.5} />
      <rect x={body.x + body.w - 2} y={body.y + body.h * 0.2} width={3} height={8}
        fill="none" stroke={silkDim} strokeWidth={0.4} opacity={0.25} rx={0.5} />

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

      {/* Exposed border — follows DIMM body shape */}
      {exposed && (
        <path ref={borderRef}
          d={`M ${body.x + 2} ${body.y}
              H ${body.x + body.w - 2}
              V ${body.y + body.h}
              H ${notchX + 7}
              V ${body.y + body.h + 6}
              H ${notchX - 7}
              V ${body.y + body.h}
              H ${body.x + 2}
              Z`}
          fill="none" stroke="#E1583E" strokeWidth={2.5}
          opacity={0.3} style={{ willChange: 'opacity' }} />
      )}
    </g>
  );
});
MemoryChip.displayName = 'MemoryChip';
