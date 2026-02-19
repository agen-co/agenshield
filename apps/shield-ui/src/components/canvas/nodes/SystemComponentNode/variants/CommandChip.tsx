/**
 * Command variant — QFP chip with die window, pin-1 marker, terminal cursor.
 * Cursor blink speed tied to cmdRate.
 *
 * Subscribes only to `systemStore.metrics.cmdRate` and `systemStore.components.command`.
 */

import { memo, useRef, useEffect } from 'react';
import { animate, type JSAnimation } from 'animejs';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder } from '../primitives';
import { pcb } from '../../../styles/pcb-tokens';
import type { VariantProps } from '../system.types';

export const CommandChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const cmdRate = snap.metrics.cmdRate;
  const { exposed, active } = snap.components.command;

  const { body } = layout;
  const { silkDim, silkColor, chipBody } = theme;
  const chipBorder = exposed ? '#E1583E' : theme.chipBorder;

  const borderRef = useExposedBorder(exposed);

  // Cursor blink speed: faster when cmdRate is higher (200ms–1200ms)
  const cursorSpeed = Math.max(200, 1200 - cmdRate * 70);
  const cursorRef = useRef<SVGRectElement>(null);
  const cursorAnimRef = useRef<JSAnimation | null>(null);

  useEffect(() => {
    cursorAnimRef.current?.cancel();
    cursorAnimRef.current = null;
    if (cursorRef.current) {
      cursorAnimRef.current = animate(cursorRef.current, {
        opacity: [0.15, 0.9],
        duration: cursorSpeed,
        ease: 'inOutSine',
        loop: true,
        alternate: true,
      });
    }
    return () => { cursorAnimRef.current?.cancel(); };
  }, [cursorSpeed]);

  // Die exposure window
  const winX = body.x + body.w * 0.2;
  const winY = body.y + body.h * 0.15;
  const winW = body.w * 0.6;
  const winH = body.h * 0.55;

  return (
    <g>
      {/* Chip body */}
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />

      {/* Die exposure window */}
      <rect x={winX} y={winY} width={winW} height={winH}
        fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.25} rx={1} />

      {/* Terminal prompt lines */}
      <g opacity={0.18}>
        <text x={winX + 4} y={winY + winH * 0.25} dominantBaseline="central"
          fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace">$ _</text>
        <line x1={winX + 4} y1={winY + winH * 0.45} x2={winX + winW * 0.7} y2={winY + winH * 0.45}
          stroke={silkDim} strokeWidth={0.5} />
        <line x1={winX + 4} y1={winY + winH * 0.6} x2={winX + winW * 0.5} y2={winY + winH * 0.6}
          stroke={silkDim} strokeWidth={0.5} />
        <line x1={winX + 4} y1={winY + winH * 0.75} x2={winX + winW * 0.65} y2={winY + winH * 0.75}
          stroke={silkDim} strokeWidth={0.5} />
      </g>

      {/* Blinking cursor — anime.js driven */}
      <rect ref={cursorRef} x={winX + 14} y={winY + winH * 0.2} width={2} height={5}
        fill={pcb.component.ledGreen} opacity={0.7} />

      {/* cmd/s label */}
      <text x={winX + winW - 3} y={winY + winH - 4} textAnchor="end" dominantBaseline="auto"
        fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.5}>{cmdRate.toFixed(1)}/s</text>

      {/* Pin-1 triangle */}
      <polygon points={`${body.x + 4},${body.y + 4} ${body.x + 9},${body.y + 4} ${body.x + 4},${body.y + 9}`}
        fill={silkDim} opacity={0.4} />

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
CommandChip.displayName = 'CommandChip';
