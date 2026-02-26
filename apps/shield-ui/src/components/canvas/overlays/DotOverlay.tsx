/**
 * SVG overlay that renders animated electric pulse dots flowing through the canvas graph.
 * Each pulse has a bright head with a gradient trailing tail.
 *
 * Dots follow orthogonal waypoint paths (matching PCB trace routing).
 *
 * Uses an imperative rAF loop with valtio subscribe() as an event signal
 * to avoid React re-renders on every dot mutation — prevents flicker.
 */

import { useRef, useEffect, useCallback } from 'react';
import { useViewport } from '@xyflow/react';
import { subscribe } from 'valtio';
import { dotAnimationStore } from '../state/dotAnimations';
import { interpolateAlongPath } from '../utils/dotInterpolation';

const HEAD_RADIUS = 3;
const TRAIL_RADIUS_MIN = 2.5;
const TRAIL_RADIUS_MAX = 4;
const COLOR_ALLOWED = '#00E5FF';
const COLOR_DENIED = '#FF1744';
const FILTER_ALLOWED = 'url(#pcb-glow-signal)';
const FILTER_DENIED = 'url(#pcb-glow-denied)';

export function DotOverlay() {
  const viewport = useViewport();
  const viewportRef = useRef(viewport);
  const svgRef = useRef<SVGSVGElement>(null);
  const animFrameRef = useRef<number>(0);
  const loopRunning = useRef(false);

  viewportRef.current = viewport;

  const render = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) { loopRunning.current = false; return; }

    const g = svg.querySelector('g[data-dots]') as SVGGElement | null;
    if (!g) { loopRunning.current = false; return; }

    const vp = viewportRef.current;
    g.setAttribute('transform', `translate(${vp.x}, ${vp.y}) scale(${vp.zoom})`);

    const now = Date.now();
    const dots = dotAnimationStore.dots;

    while (g.firstChild) g.removeChild(g.firstChild);

    for (const dot of dots) {
      const elapsed = now - dot.startTime;
      const color = dot.color ?? (dot.denied ? COLOR_DENIED : COLOR_ALLOWED);
      const filter = dot.denied ? FILTER_DENIED : FILTER_ALLOWED;

      const pulse = interpolateAlongPath(
        dot.waypoints,
        dot.pathLength,
        elapsed,
        dot.duration,
        dot.phase,
      );

      // Trail circles (back to front, larger with decreasing opacity)
      const trailCount = pulse.trail.length;
      for (let i = trailCount - 1; i >= 0; i--) {
        const tp = pulse.trail[i];
        const r = TRAIL_RADIUS_MIN + ((TRAIL_RADIUS_MAX - TRAIL_RADIUS_MIN) * i) / trailCount;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(tp.x));
        circle.setAttribute('cy', String(tp.y));
        circle.setAttribute('r', String(r));
        circle.setAttribute('fill', color);
        circle.setAttribute('opacity', String(Math.max(0, tp.opacity)));
        g.appendChild(circle);
      }

      // Head circle (bright, with glow filter)
      const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      head.setAttribute('cx', String(pulse.x));
      head.setAttribute('cy', String(pulse.y));
      head.setAttribute('r', String(HEAD_RADIUS));
      head.setAttribute('fill', color);
      head.setAttribute('opacity', String(pulse.opacity));
      head.setAttribute('filter', filter);
      g.appendChild(head);
    }

    if (dots.length > 0) {
      animFrameRef.current = requestAnimationFrame(render);
    } else {
      loopRunning.current = false;
    }
  }, []);

  useEffect(() => {
    const unsub = subscribe(dotAnimationStore, () => {
      if (dotAnimationStore.dots.length > 0 && !loopRunning.current) {
        loopRunning.current = true;
        animFrameRef.current = requestAnimationFrame(render);
      }
    });
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
