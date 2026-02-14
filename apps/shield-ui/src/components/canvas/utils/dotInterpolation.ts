/**
 * Animation math for dot interpolation along paths between nodes.
 */

export interface Point {
  x: number;
  y: number;
}

export interface DotRenderState {
  x: number;
  y: number;
  opacity: number;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Estimated node center positions based on node dimensions.
 * Uses typical sizes from the canvas node styles.
 */
const NODE_SIZE_ESTIMATES: Record<string, { w: number; h: number }> = {
  'canvas-target': { w: 150, h: 80 },
  'canvas-target-stats': { w: 170, h: 30 },
  'canvas-policy-graph': { w: 500, h: 60 },
  'canvas-firewall-piece': { w: 160, h: 50 },
  'canvas-computer': { w: 200, h: 80 },
  'canvas-denied-bucket': { w: 140, h: 50 },
};

export function getNodeCenter(
  position: Point,
  nodeType?: string,
): Point {
  const size = NODE_SIZE_ESTIMATES[nodeType ?? ''] ?? { w: 120, h: 50 };
  return {
    x: position.x + size.w / 2,
    y: position.y + size.h / 2,
  };
}

/**
 * Interpolates the position of a dot between two points given elapsed time and duration.
 * Opacity fading is phase-aware: fade-in only on first phase, fade-out only on last phase.
 */
export function interpolateDotPosition(
  from: Point,
  to: Point,
  elapsed: number,
  duration: number,
  phase?: 'to-policy' | 'to-firewall' | 'to-destination',
): DotRenderState {
  const t = Math.min(1, elapsed / duration);
  const eased = easeInOutCubic(t);

  // Phase-aware fading: fade-in only at the start of first phase,
  // fade-out only at the end of last phase. No fading between phases.
  let opacity = 1;
  if (phase === 'to-policy' && t < 0.15) {
    opacity = t / 0.15;
  } else if (phase === 'to-destination' && t > 0.85) {
    opacity = (1 - t) / 0.15;
  }

  return {
    x: lerp(from.x, to.x, eased),
    y: lerp(from.y, to.y, eased),
    opacity,
  };
}
