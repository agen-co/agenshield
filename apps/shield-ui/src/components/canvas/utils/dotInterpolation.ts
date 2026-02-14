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
 */
export function interpolateDotPosition(
  from: Point,
  to: Point,
  elapsed: number,
  duration: number,
): DotRenderState {
  const t = Math.min(1, elapsed / duration);
  const eased = easeInOutCubic(t);

  // Fade in during first 10%, fade out during last 10%
  let opacity = 1;
  if (t < 0.1) opacity = t / 0.1;
  else if (t > 0.9) opacity = (1 - t) / 0.1;

  return {
    x: lerp(from.x, to.x, eased),
    y: lerp(from.y, to.y, eased),
    opacity,
  };
}
