/**
 * Logs variant — QFP chip with log lines, buffer capacitor, crystal oscillator.
 * Line opacity and pulse speed tied to logRate.
 *
 * Subscribes only to `systemStore.metrics.logRate` and `systemStore.components.logs`.
 */

import { memo, useRef, useEffect } from 'react';
import { animate, type JSAnimation } from 'animejs';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder } from '../primitives';
import type { VariantProps } from '../system.types';

export const LogsChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const logRate = snap.metrics.logRate;
  const { exposed, active } = snap.components.logs;

  const { body } = layout;
  const { silkDim, silkColor, chipBody } = theme;
  const chipBorder = exposed ? '#E1583E' : theme.chipBorder;

  const borderRef = useExposedBorder(exposed);

  const lineWidths = [0.75, 0.5, 0.85, 0.6, 0.4, 0.7, 0.55];
  const lineOpacity = 0.1 + Math.min(logRate / 80, 1) * 0.35;
  const pulseSpeed = Math.max(500, 2500 - logRate * 25);

  // Log lines pulse animation
  const linesRef = useRef<SVGGElement>(null);
  const linesAnimRef = useRef<JSAnimation | null>(null);

  useEffect(() => {
    linesAnimRef.current?.cancel();
    linesAnimRef.current = null;
    if (linesRef.current) {
      linesAnimRef.current = animate(linesRef.current, {
        opacity: [lineOpacity * 0.5, lineOpacity],
        duration: pulseSpeed,
        ease: 'inOutSine',
        loop: true,
        alternate: true,
      });
    }
    return () => { linesAnimRef.current?.cancel(); };
  }, [lineOpacity, pulseSpeed]);

  return (
    <g>
      {/* Chip body */}
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />

      {/* Log lines — anime.js driven pulse */}
      <g ref={linesRef} opacity={lineOpacity} style={{ willChange: 'opacity' }}>
        {lineWidths.map((wFrac, i) => (
          <line key={`ll-${i}`}
            x1={body.x + 8} y1={body.y + 10 + i * ((body.h - 20) / 6)}
            x2={body.x + 8 + (body.w - 16) * wFrac} y2={body.y + 10 + i * ((body.h - 20) / 6)}
            stroke={silkDim} strokeWidth={0.9} strokeLinecap="round" />
        ))}
      </g>

      {/* Log rate label */}
      <text x={body.x + body.w - 5} y={body.y + body.h - 4} textAnchor="end" dominantBaseline="auto"
        fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.5}>{Math.round(logRate)}/s</text>

      {/* Buffer capacitor */}
      <g opacity={0.3}>
        <rect x={body.x + body.w - 10} y={body.y + body.h - 8} width={6} height={4}
          fill="none" stroke={silkDim} strokeWidth={0.5} rx={0.4} />
        <text x={body.x + body.w - 7} y={body.y + body.h - 6} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={2.5} fontFamily="'IBM Plex Mono', monospace">C1</text>
      </g>

      {/* Crystal oscillator */}
      <g opacity={0.2}>
        <rect x={body.x + 4} y={body.y + body.h - 10} width={4} height={7}
          fill="none" stroke={silkDim} strokeWidth={0.4} rx={1} />
        <text x={body.x + 6} y={body.y + body.h - 3} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={2} fontFamily="'IBM Plex Mono', monospace">Y1</text>
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
LogsChip.displayName = 'LogsChip';
