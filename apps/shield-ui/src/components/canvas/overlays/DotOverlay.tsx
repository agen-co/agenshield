/**
 * SVG overlay that renders animated dots flowing through the canvas graph.
 * Positioned absolutely inside <ReactFlow>, synced with viewport transform.
 *
 * Uses an imperative rAF loop with valtio subscribe() as an event signal
 * to avoid React re-renders on every dot mutation — prevents flicker.
 */

import { useRef, useEffect, useCallback } from 'react';
import { useViewport } from '@xyflow/react';
import { subscribe } from 'valtio';
import { dotAnimationStore } from '../state/dotAnimations';
import { interpolateDotPosition } from '../utils/dotInterpolation';

const DOT_RADIUS = 4;
const COLOR_ALLOWED = '#6CB685';
const COLOR_DENIED = '#E1583E';

export function DotOverlay() {
  const viewport = useViewport();
  const viewportRef = useRef(viewport);
  const svgRef = useRef<SVGSVGElement>(null);
  const animFrameRef = useRef<number>(0);
  const loopRunning = useRef(false);

  // Keep viewport ref in sync — runs on viewport change but does NOT restart rAF
  viewportRef.current = viewport;

  const render = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) { loopRunning.current = false; return; }

    const g = svg.querySelector('g[data-dots]') as SVGGElement | null;
    if (!g) { loopRunning.current = false; return; }

    // Apply viewport transform imperatively
    const vp = viewportRef.current;
    g.setAttribute('transform', `translate(${vp.x}, ${vp.y}) scale(${vp.zoom})`);

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
        dot.phase,
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
    } else {
      loopRunning.current = false;
    }
  }, []);

  // Event-driven loop start: subscribe to store, start loop when dots appear
  useEffect(() => {
    const unsub = subscribe(dotAnimationStore, () => {
      if (dotAnimationStore.dots.length > 0 && !loopRunning.current) {
        loopRunning.current = true;
        animFrameRef.current = requestAnimationFrame(render);
      }
    });
    // Start immediately if dots already exist
    if (dotAnimationStore.dots.length > 0 && !loopRunning.current) {
      loopRunning.current = true;
      animFrameRef.current = requestAnimationFrame(render);
    }
    return () => {
      unsub();
      cancelAnimationFrame(animFrameRef.current);
      loopRunning.current = false;
    };
  }, [render]);

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
      <g data-dots="" />
    </svg>
  );
}
