/**
 * Alert triangle indicator — LED-style, always visible as physical hardware.
 *
 * - Off (exposed = false): dark recessed LED housing with faint outline
 * - On (exposed = true): glowing red LED with breathing pulse
 *
 * All animations driven by anime.js (no CSS keyframes).
 */

import { memo, useRef, useEffect } from 'react';
import { animate, type JSAnimation } from 'animejs';
import { pcb } from '../../../styles/pcb-tokens';

interface AlertIndicatorProps {
  x: number;
  y: number;
  exposed: boolean;
  silkDim: string;
}

export const AlertIndicator = memo(({ x, y, exposed, silkDim }: AlertIndicatorProps) => {
  const glowRef = useRef<SVGPolygonElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const animsRef = useRef<JSAnimation[]>([]);
  const size = 16;

  useEffect(() => {
    animsRef.current.forEach((a) => a.cancel());
    animsRef.current = [];

    if (exposed && glowRef.current && dotRef.current) {
      animsRef.current.push(
        animate(glowRef.current, {
          opacity: [0.08, 0.3],
          duration: 3000,
          ease: 'inOutSine',
          loop: true,
          alternate: true,
        }),
      );
      animsRef.current.push(
        animate(dotRef.current, {
          opacity: [0.6, 1],
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
  }, [exposed]);

  const strokeColor = exposed ? '#E1583E' : silkDim;

  return (
    <g>
      {/* Outer glow — diffuse triangle halo */}
      <polygon
        ref={glowRef}
        points={`${x},${y - size / 2 - 3} ${x - size / 2 - 3},${y + size / 2 + 3} ${x + size / 2 + 3},${y + size / 2 + 3}`}
        fill="#E1583E"
        opacity={exposed ? 0.15 : 0}
        filter="url(#canvas-glow-red)"
        style={{ willChange: 'opacity' }}
      />
      {/* Triangle body — recessed housing when off, lit when on */}
      <polygon
        points={`${x},${y - size / 2} ${x - size / 2},${y + size / 2} ${x + size / 2},${y + size / 2}`}
        fill={exposed ? 'rgba(225,88,62,0.12)' : pcb.component.ledOff}
        fillOpacity={exposed ? 1 : 0.25}
        stroke={strokeColor}
        strokeWidth={exposed ? 1.5 : 0.8}
        strokeOpacity={exposed ? 0.9 : 0.15}
        strokeLinejoin="round" strokeLinecap="round" />
      {/* Exclamation line */}
      <line x1={x} y1={y - 3} x2={x} y2={y + 2}
        stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round"
        opacity={exposed ? 0.9 : 0.12} />
      {/* Exclamation dot — the LED "hot spot" */}
      <circle ref={dotRef} cx={x} cy={y + 5} r={1}
        fill={strokeColor}
        opacity={exposed ? 0.9 : 0.12}
        style={{ willChange: 'opacity' }} />
    </g>
  );
});
AlertIndicator.displayName = 'AlertIndicator';
