/**
 * Animation math for dot interpolation along paths between nodes.
 */

export interface Point {
  x: number;
  y: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  opacity: number;
}

export interface DotRenderState {
  x: number;
  y: number;
  opacity: number;
}

export interface PulseRenderState {
  x: number;
  y: number;
  opacity: number;
  trail: TrailPoint[];
  angle: number;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Fast start, smooth deceleration — feels like an electric current shot */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Estimated node center positions based on node dimensions.
 * Uses typical sizes from the canvas node styles.
 */
const NODE_SIZE_ESTIMATES: Record<string, { w: number; h: number }> = {
  'canvas-target': { w: 150, h: 80 },
  'canvas-target-stats': { w: 170, h: 30 },
  'canvas-core': { w: 500, h: 80 },
  'canvas-firewall-piece': { w: 160, h: 50 },
  'canvas-computer': { w: 209, h: 70 },
  'canvas-denied-bucket': { w: 140, h: 50 },
  'canvas-controller': { w: 98, h: 59 },
  'canvas-hud-indicator': { w: 59, h: 44 },
  'canvas-system-metrics': { w: 99, h: 60 },
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

const TRAIL_COUNT = 5;
const TRAIL_STEP = 0.03;

/**
 * Interpolates a position along an orthogonal waypoint path at a given fraction (0..1).
 */
function interpolateWaypointPath(waypoints: Point[], pathLength: number, fraction: number): Point {
  if (waypoints.length < 2) return waypoints[0] ?? { x: 0, y: 0 };
  if (pathLength <= 0) return waypoints[0];

  const targetDist = fraction * pathLength;
  let accumulated = 0;

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (accumulated + segLen >= targetDist) {
      const remaining = targetDist - accumulated;
      const t = segLen > 0 ? remaining / segLen : 0;
      return {
        x: prev.x + dx * t,
        y: prev.y + dy * t,
      };
    }

    accumulated += segLen;
  }

  return waypoints[waypoints.length - 1];
}

/**
 * Computes the angle of travel at a given fraction along a waypoint path.
 */
function getPathAngle(waypoints: Point[], pathLength: number, fraction: number): number {
  if (waypoints.length < 2) return 0;

  const targetDist = fraction * pathLength;
  let accumulated = 0;

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (accumulated + segLen >= targetDist || i === waypoints.length - 1) {
      return Math.atan2(dy, dx);
    }

    accumulated += segLen;
  }

  return 0;
}

/**
 * Interpolates the position of a pulse along a waypoint path with trailing gradient.
 * Uses easeOutCubic for fast-start electric current feel.
 */
export function interpolateAlongPath(
  waypoints: Point[],
  pathLength: number,
  elapsed: number,
  duration: number,
  phase?: 'to-policy' | 'to-firewall' | 'to-destination',
): PulseRenderState {
  const t = Math.min(1, elapsed / duration);
  const eased = easeOutCubic(t);

  // Phase-aware fading
  let opacity = 1;
  if (phase === 'to-policy' && t < 0.15) {
    opacity = t / 0.15;
  } else if (phase === 'to-destination' && t > 0.85) {
    opacity = (1 - t) / 0.15;
  }

  const pos = interpolateWaypointPath(waypoints, pathLength, eased);
  const angle = getPathAngle(waypoints, pathLength, eased);

  // Compute trail positions along the same path
  const trail: TrailPoint[] = [];
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const trailT = Math.max(0, t - (i + 1) * TRAIL_STEP);
    const trailEased = easeOutCubic(trailT);
    const trailPos = interpolateWaypointPath(waypoints, pathLength, trailEased);
    trail.push({
      x: trailPos.x,
      y: trailPos.y,
      opacity: opacity * (0.7 - i * 0.12),
    });
  }

  return { x: pos.x, y: pos.y, opacity, trail, angle };
}

/**
 * Legacy interpolation between two points (straight line).
 * Still used by callers that don't have waypoint data.
 */
export function interpolatePulsePosition(
  from: Point,
  to: Point,
  elapsed: number,
  duration: number,
  phase?: 'to-policy' | 'to-firewall' | 'to-destination',
): PulseRenderState {
  return interpolateAlongPath([from, to], Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2), elapsed, duration, phase);
}

/**
 * Backward-compatible interpolation (used by legacy callers).
 */
export function interpolateDotPosition(
  from: Point,
  to: Point,
  elapsed: number,
  duration: number,
  phase?: 'to-policy' | 'to-firewall' | 'to-destination',
): DotRenderState {
  const { x, y, opacity } = interpolatePulsePosition(from, to, elapsed, duration, phase);
  return { x, y, opacity };
}
