/**
 * Network variant — NIC with RJ45, transformer coils, edge connector.
 * Shows ↑↓ throughput indicators driven by netUp/netDown.
 *
 * Subscribes only to `systemStore.metrics.netUp/netDown` and `systemStore.components.network`.
 */

import { memo, useRef, useEffect } from 'react';
import { animate, type JSAnimation } from 'animejs';
import { useSnapshot } from 'valtio';
import { systemStore } from '../../../../../state/system-store';
import { StatusLed, AlertIndicator, useExposedBorder, formatRate, MiniSparkline } from '../primitives';
import { pcb } from '../../../styles/pcb-tokens';
import type { VariantProps } from '../system.types';

export const NetworkChip = memo(({ label, sublabel, refDesignator, theme, layout }: VariantProps) => {
  const snap = useSnapshot(systemStore);
  const netUp = snap.metrics.netUp;
  const netDown = snap.metrics.netDown;
  const { exposed, active } = snap.components.network;

  const { body } = layout;
  const { padColor, silkDim, silkColor, chipBody, isDark } = theme;
  const chipBorder = exposed ? '#E1583E' : theme.chipBorder;

  const borderRef = useExposedBorder<SVGPathElement>(exposed);

  // Amber LED blink animation
  const amberLedRef = useRef<SVGCircleElement>(null);
  const amberAnimRef = useRef<JSAnimation | null>(null);

  useEffect(() => {
    amberAnimRef.current?.cancel();
    amberAnimRef.current = null;
    if (active && amberLedRef.current) {
      amberAnimRef.current = animate(amberLedRef.current, {
        opacity: [0.15, 0.9],
        duration: 800,
        ease: 'inOutSine',
        loop: true,
        alternate: true,
      });
    }
    return () => { amberAnimRef.current?.cancel(); };
  }, [active]);

  const notchW = 26;
  const notchH = 22;

  const coilCx = body.x + 18;
  const coilCy = body.y + body.h / 2;

  // Throughput indicator positions
  const indX = body.x + body.w * 0.42;
  const indY = body.y + body.h * 0.35;

  return (
    <g>
      {/* Main body with RJ45 notch */}
      <path
        d={`M ${body.x + 2} ${body.y}
            H ${body.x + body.w - notchW - 2}
            V ${body.y + (body.h - notchH) / 2}
            H ${body.x + body.w - 2}
            V ${body.y + (body.h + notchH) / 2}
            H ${body.x + body.w - notchW - 2}
            V ${body.y + body.h}
            H ${body.x + 2}
            Z`}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6}
      />
      <rect x={body.x} y={body.y} width={body.w} height={body.h}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.2} />

      {/* RJ45 port inner with latch */}
      <rect x={body.x + body.w - notchW + 2} y={body.y + (body.h - notchH) / 2 + 2}
        width={notchW - 6} height={notchH - 4}
        fill={isDark ? '#0A0A0C' : '#D0D0CC'} stroke={chipBorder} strokeWidth={0.4} rx={1} />
      <rect x={body.x + body.w - notchW + 3} y={body.y + (body.h - notchH) / 2 - 1.5}
        width={notchW - 8} height={2}
        fill={padColor} opacity={0.4} rx={0.3} />
      {/* Port contact pins */}
      {Array.from({ length: 4 }, (_, i) => (
        <line key={`rjp-${i}`}
          x1={body.x + body.w - notchW + 5 + i * 3} y1={body.y + (body.h - notchH) / 2 + 4}
          x2={body.x + body.w - notchW + 5 + i * 3} y2={body.y + (body.h + notchH) / 2 - 4}
          stroke={padColor} strokeWidth={0.4} opacity={0.3} />
      ))}

      {/* Status LEDs inside port */}
      <circle cx={body.x + body.w - 6} cy={body.y + (body.h - notchH) / 2 + 4} r={1.5}
        fill={pcb.component.ledGreen} opacity={0.7} />
      <circle ref={amberLedRef} cx={body.x + body.w - 6} cy={body.y + (body.h + notchH) / 2 - 4} r={1.5}
        fill={pcb.component.ledAmber} opacity={0.6} />

      {/* Transformer coils */}
      <g opacity={0.25} stroke={silkDim} fill="none" strokeWidth={0.6}>
        <path d={`M ${coilCx - 5} ${coilCy - 7} Q ${coilCx - 2} ${coilCy - 7} ${coilCx - 2} ${coilCy - 4}
          Q ${coilCx - 2} ${coilCy - 1} ${coilCx - 5} ${coilCy - 1}
          Q ${coilCx - 2} ${coilCy - 1} ${coilCx - 2} ${coilCy + 2}
          Q ${coilCx - 2} ${coilCy + 5} ${coilCx - 5} ${coilCy + 5}
          Q ${coilCx - 2} ${coilCy + 5} ${coilCx - 2} ${coilCy + 7}`} />
        <line x1={coilCx} y1={coilCy - 8} x2={coilCx} y2={coilCy + 8} />
        <path d={`M ${coilCx + 5} ${coilCy - 7} Q ${coilCx + 2} ${coilCy - 7} ${coilCx + 2} ${coilCy - 4}
          Q ${coilCx + 2} ${coilCy - 1} ${coilCx + 5} ${coilCy - 1}
          Q ${coilCx + 2} ${coilCy - 1} ${coilCx + 2} ${coilCy + 2}
          Q ${coilCx + 2} ${coilCy + 5} ${coilCx + 5} ${coilCy + 5}
          Q ${coilCx + 2} ${coilCy + 5} ${coilCx + 2} ${coilCy + 7}`} />
      </g>

      {/* Sparkline background */}
      <MiniSparkline dataKey="netDown"
        x={body.x + 30} y={body.y + body.h * 0.55}
        w={body.w * 0.35} h={body.h * 0.3}
        color={pcb.signal.cyan} />

      {/* Throughput indicators */}
      <g opacity={0.7}>
        <polygon points={`${indX},${indY - 4} ${indX - 2.5},${indY} ${indX + 2.5},${indY}`}
          fill={pcb.component.ledGreen} opacity={0.7} />
        <text x={indX + 5} y={indY - 1.5} textAnchor="start" dominantBaseline="central"
          fill={pcb.component.ledGreen} fontSize={7} fontFamily="'IBM Plex Mono', monospace"
          fontWeight={700} opacity={0.8}>
          {formatRate(netUp)}
        </text>
        <polygon points={`${indX},${indY + 10} ${indX - 2.5},${indY + 6} ${indX + 2.5},${indY + 6}`}
          fill={pcb.component.ledAmber} opacity={0.7} />
        <text x={indX + 5} y={indY + 8.5} textAnchor="start" dominantBaseline="central"
          fill={pcb.component.ledAmber} fontSize={7} fontFamily="'IBM Plex Mono', monospace"
          fontWeight={700} opacity={0.8}>
          {formatRate(netDown)}
        </text>
      </g>

      {/* MAC address */}
      <text x={body.x + 8} y={body.y + body.h - 4} textAnchor="start" dominantBaseline="central"
        fill={silkDim} fontSize={3} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.3}>00:1A:2B:3C:4D</text>

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

      {/* Status LED — inside main body, left of notch */}
      <StatusLed x={body.x + body.w - notchW - 16} y={body.y + 14}
        active={active} exposed={exposed} silkDim={silkDim} />

      {/* Alert indicator — inside main body, left of notch */}
      <AlertIndicator x={body.x + body.w - notchW - 16} y={body.y + body.h - 22}
        exposed={exposed} silkDim={silkDim} />

      {/* Exposed border — follows RJ45 body shape */}
      {exposed && (
        <path ref={borderRef}
          d={`M ${body.x + 2} ${body.y}
              H ${body.x + body.w - notchW - 2}
              V ${body.y + (body.h - notchH) / 2}
              H ${body.x + body.w - 2}
              V ${body.y + (body.h + notchH) / 2}
              H ${body.x + body.w - notchW - 2}
              V ${body.y + body.h}
              H ${body.x + 2}
              Z`}
          fill="none" stroke="#E1583E" strokeWidth={2.5}
          opacity={0.3} style={{ willChange: 'opacity' }} />
      )}
    </g>
  );
});
NetworkChip.displayName = 'NetworkChip';
