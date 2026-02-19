/**
 * PcbBackground — lightweight decorative PCB background node.
 *
 * Renders subtle SVG patterns (trace grid, via dots, a few curved PCB traces)
 * that tile seamlessly. Theme-aware for dark/light mode.
 */

import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../styles/pcb-tokens';
import type { PcbBackgroundData } from '../Canvas.types';

export const PcbBackground = memo(({ data }: NodeProps) => {
  const { width: svgW, height: svgH } = data as unknown as PcbBackgroundData;
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const baseColor = isDark ? pcb.board.base : pcb.light.base;
  const traceColor = isDark ? pcb.board.traceFaint : 'rgba(160,160,160,0.15)';
  const viaColor = isDark ? pcb.via.ring : pcb.via.fill;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const traceOpacity = isDark ? 0.06 : 0.08;

  return (
    <svg
      width={svgW}
      height={svgH}
      style={{ pointerEvents: 'none', display: 'block' }}
    >
      <defs>
        {/* Thin trace grid — 48px spacing */}
        <pattern id="pcb-bg-grid" width={48} height={48} patternUnits="userSpaceOnUse">
          <line x1={0} y1={0} x2={48} y2={0} stroke={traceColor} strokeWidth={0.4} opacity={0.5} />
          <line x1={0} y1={0} x2={0} y2={48} stroke={traceColor} strokeWidth={0.4} opacity={0.5} />
        </pattern>

        {/* Via dot grid — 96px spacing */}
        <pattern id="pcb-bg-vias" width={96} height={96} patternUnits="userSpaceOnUse">
          <circle cx={48} cy={48} r={2} fill="none" stroke={viaColor} strokeWidth={0.6} opacity={0.2} />
          <circle cx={48} cy={48} r={0.8} fill={viaColor} opacity={0.15} />
        </pattern>
      </defs>

      {/* Base fill */}
      <rect width={svgW} height={svgH} fill={baseColor} />

      {/* Trace grid */}
      <rect width={svgW} height={svgH} fill="url(#pcb-bg-grid)" />

      {/* Via dots */}
      <rect width={svgW} height={svgH} fill="url(#pcb-bg-vias)" />

      {/* Decorative curved PCB traces */}
      <g opacity={traceOpacity} stroke={isDark ? '#555' : '#999'} fill="none" strokeWidth={0.5}>
        <path d={`M 0 ${svgH * 0.12} Q ${svgW * 0.3} ${svgH * 0.08} ${svgW * 0.5} ${svgH * 0.14} T ${svgW} ${svgH * 0.1}`} />
        <path d={`M 0 ${svgH * 0.88} Q ${svgW * 0.25} ${svgH * 0.92} ${svgW * 0.6} ${svgH * 0.86} T ${svgW} ${svgH * 0.9}`} />
        <path d={`M ${svgW * 0.06} 0 Q ${svgW * 0.04} ${svgH * 0.3} ${svgW * 0.08} ${svgH * 0.6} T ${svgW * 0.05} ${svgH}`} />
      </g>

      {/* Board edge */}
      <rect
        x={10} y={10}
        width={Math.max(0, svgW - 20)}
        height={Math.max(0, svgH - 20)}
        fill="none" stroke={silkDim} strokeWidth={0.6}
        strokeDasharray="4 3" opacity={0.15} rx={2}
      />

      {/* Corner silkscreen text */}
      <text x={50} y={22} fill={silkDim} fontSize={5}
        fontFamily="'IBM Plex Mono', monospace" letterSpacing={2}
        fontWeight={600} opacity={0.12}>
        AGENSHIELD MAIN BOARD
      </text>
      <text x={50} y={32} fill={silkDim} fontSize={3.5}
        fontFamily="'IBM Plex Mono', monospace" letterSpacing={1} opacity={0.1}>
        REV 2.0
      </text>
    </svg>
  );
});
PcbBackground.displayName = 'PcbBackground';
