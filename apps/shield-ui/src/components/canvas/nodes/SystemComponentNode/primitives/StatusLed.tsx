/**
 * Status LED — always visible as etched hardware.
 *
 * - Green glow when active & safe
 * - Red glow when active & exposed
 * - Dim outline when inactive
 *
 * All animations driven by anime.js (no CSS keyframes).
 */

import { memo, useRef, useEffect } from 'react';
import { animate, type JSAnimation } from 'animejs';

interface StatusLedProps {
  x: number;
  y: number;
  active: boolean;
  exposed: boolean;
  silkDim: string;
}

export const StatusLed = memo(({ x, y, active, exposed, silkDim }: StatusLedProps) => {
  const glowRef = useRef<SVGCircleElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const animsRef = useRef<JSAnimation[]>([]);

  const color = exposed ? '#D43F3F' : '#3DC75F';

  useEffect(() => {
    animsRef.current.forEach((a) => a.cancel());
    animsRef.current = [];

    if (active && glowRef.current && dotRef.current) {
      animsRef.current.push(
        animate(glowRef.current, {
          opacity: [0.08, 0.25],
          duration: 3000,
          ease: 'inOutSine',
          loop: true,
          alternate: true,
        }),
      );
      animsRef.current.push(
        animate(dotRef.current, {
          opacity: [0.7, 1],
          duration: 2000,
          ease: 'inOutSine',
          loop: true,
          alternate: true,
        }),
      );
    }

    return () => {
      animsRef.current.forEach((a) => a.cancel());
      animsRef.current = [];
    };
  }, [active, exposed]);

  return (
    <g>
      {/* Outer glow */}
      <circle ref={glowRef} cx={x} cy={y} r={10}
        fill={color} opacity={active ? 0.15 : 0}
        style={{ willChange: 'opacity' }} />
      {/* Ring — always visible */}
      <circle cx={x} cy={y} r={6}
        fill="none" stroke={active ? color : silkDim}
        strokeWidth={0.8} opacity={active ? 0.8 : 0.2} />
      {/* Inner dot — always visible */}
      <circle ref={dotRef} cx={x} cy={y} r={3.5}
        fill={active ? color : silkDim}
        opacity={active ? 0.9 : 0.12}
        style={{ willChange: 'opacity' }} />
      {/* STS label */}
      <text x={x - 10} y={y + 0.5} textAnchor="end" dominantBaseline="central"
        fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.5}>STS</text>
    </g>
  );
});
StatusLed.displayName = 'StatusLed';
