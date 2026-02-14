/**
 * SVG overlay that renders animated dots flowing through the canvas graph.
 * Positioned absolutely inside <ReactFlow>, synced with viewport transform.
 */

import { useRef, useEffect, useCallback } from 'react';
import { useViewport } from '@xyflow/react';
import { useSnapshot } from 'valtio';
import { dotAnimationStore } from '../state/dotAnimations';
import { interpolateDotPosition } from '../utils/dotInterpolation';

const DOT_RADIUS = 4;
const COLOR_ALLOWED = '#6CB685';
const COLOR_DENIED = '#E1583E';

export function DotOverlay() {
  const viewport = useViewport();
  const snap = useSnapshot(dotAnimationStore);
  const svgRef = useRef<SVGSVGElement>(null);
  const animFrameRef = useRef<number>(0);

  const render = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const g = svg.querySelector('g[data-dots]') as SVGGElement | null;
    if (!g) return;

    const now = Date.now();
    const dots = dotAnimationStore.dots;

    // Clear existing circles and recreate
    while (g.firstChild) g.removeChild(g.firstChild);

    for (const dot of dots) {
      const elapsed = now - dot.startTime;
      const { x, y, opacity } = interpolateDotPosition(
        dot.from,
        dot.to,
        elapsed,
        dot.duration,
      );

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', String(DOT_RADIUS));
      circle.setAttribute('fill', dot.denied ? COLOR_DENIED : COLOR_ALLOWED);
      circle.setAttribute('opacity', String(opacity));
      circle.setAttribute(
        'filter',
        dot.denied ? 'url(#canvas-glow-red)' : 'url(#canvas-glow-green)',
      );
      g.appendChild(circle);
    }

    if (dots.length > 0) {
      animFrameRef.current = requestAnimationFrame(render);
    }
  }, []);

  // Re-trigger animation loop when dots change
  useEffect(() => {
    if (snap.dots.length > 0) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(render);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [snap.dots.length, render]);

  return (
    <svg
      ref={svgRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      <g
        data-dots=""
        transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}
      />
    </svg>
  );
}
