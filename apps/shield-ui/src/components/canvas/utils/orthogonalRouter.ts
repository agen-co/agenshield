/**
 * Orthogonal (Manhattan-style) PCB trace router.
 *
 * Produces SVG paths using only H and V commands (90-degree bends)
 * that look like real PCB traces on a motherboard.
 */

import { Position } from '@xyflow/react';

export interface Point {
  x: number;
  y: number;
}

export interface OrthogonalRoute {
  /** SVG d="" string (M, H, V, and L commands) */
  path: string;
  /** All corner points including start and end */
  waypoints: Point[];
  /** Sum of all segment lengths */
  totalLength: number;
}

/**
 * Computes a Manhattan-style orthogonal route between two points.
 *
 * Routing strategy:
 * - Vertical connections (Bottom→Top): V(down to midY) → H(across) → V(down to target)
 * - Horizontal connections (Right→Left): H(right to midX) → V(across) → H(right to target)
 * - channelOffset * channelSpacing shifts the mid-segment for parallel traces
 * - Degenerate cases: skip mid-segment when source/target are already aligned
 */
export function computeOrthogonalRoute(
  source: Point,
  target: Point,
  sourcePosition: Position,
  targetPosition: Position,
  options?: { channelOffset?: number; channelSpacing?: number; chamferRadius?: number },
): OrthogonalRoute {
  const channelOffset = options?.channelOffset ?? 0;
  const channelSpacing = options?.channelSpacing ?? 8;
  const chamferRadius = options?.chamferRadius ?? 0;
  const shift = channelOffset * channelSpacing;

  const sourceHorizontal =
    sourcePosition === Position.Left || sourcePosition === Position.Right;
  const targetHorizontal =
    targetPosition === Position.Left || targetPosition === Position.Right;
  const sourceVertical =
    sourcePosition === Position.Top || sourcePosition === Position.Bottom;
  const targetVertical =
    targetPosition === Position.Top || targetPosition === Position.Bottom;

  const waypoints: Point[] = [source];

  if (sourceVertical && targetVertical) {
    // Both vertical (Bottom→Top, Top→Bottom): V → H → V
    const midY = (source.y + target.y) / 2 + shift;

    if (Math.abs(source.x - target.x) < 1) {
      waypoints.push(target);
    } else {
      waypoints.push({ x: source.x, y: midY });
      waypoints.push({ x: target.x, y: midY });
      waypoints.push(target);
    }
  } else if (sourceHorizontal && targetHorizontal) {
    // Both horizontal (Right→Left, Left→Right): H → V → H
    const midX = (source.x + target.x) / 2 + shift;

    if (Math.abs(source.y - target.y) < 1) {
      waypoints.push(target);
    } else {
      waypoints.push({ x: midX, y: source.y });
      waypoints.push({ x: midX, y: target.y });
      waypoints.push(target);
    }
  } else if (sourceHorizontal && targetVertical) {
    // Mixed: source exits horizontally, target receives vertically → L-bend (H then V)
    if (Math.abs(source.x - target.x) < 1 || Math.abs(source.y - target.y) < 1) {
      waypoints.push(target);
    } else {
      waypoints.push({ x: target.x, y: source.y });
      waypoints.push(target);
    }
  } else if (sourceVertical && targetHorizontal) {
    // Mixed: source exits vertically, target receives horizontally → L-bend (V then H)
    if (Math.abs(source.x - target.x) < 1 || Math.abs(source.y - target.y) < 1) {
      waypoints.push(target);
    } else {
      waypoints.push({ x: source.x, y: target.y });
      waypoints.push(target);
    }
  } else {
    // Fallback — straight line
    waypoints.push(target);
  }

  return buildRoute(waypoints, chamferRadius);
}

/**
 * Builds an OrthogonalRoute from raw waypoints: applies chamfering,
 * generates SVG path string, and computes total length.
 */
function buildRoute(waypoints: Point[], chamferRadius: number): OrthogonalRoute {
  const chamfered = chamferRadius > 0
    ? chamferWaypoints(waypoints, chamferRadius)
    : waypoints;

  let path = `M ${chamfered[0].x} ${chamfered[0].y}`;
  let totalLength = 0;

  for (let i = 1; i < chamfered.length; i++) {
    const prev = chamfered[i - 1];
    const curr = chamfered[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;

    if (Math.abs(dy) < 0.5) {
      path += ` H ${curr.x}`;
      totalLength += Math.abs(dx);
    } else if (Math.abs(dx) < 0.5) {
      path += ` V ${curr.y}`;
      totalLength += Math.abs(dy);
    } else {
      path += ` L ${curr.x} ${curr.y}`;
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }
  }

  return { path, waypoints: chamfered, totalLength };
}

export interface FanoutOptions {
  stubTop?: number;       // vertical exit stub from source (default 15)
  stubBottom?: number;    // vertical entry stub to target (default 15)
  chamferRadius?: number; // V↔D transition chamfer (default 0)
  balanced?: boolean;     // split vertical distance into equal thirds
}

/**
 * Computes a V-D-V (vertical-diagonal-vertical) fanout route.
 *
 * Used for PCB breakout routing from PCI slots to application cards:
 * - Vertical exit stub from source pin
 * - Diagonal fan-out segment
 * - Vertical entry stub to target pin
 *
 * Within a bundle, all wires share the same dx so diagonals are parallel.
 * Between bundles, monotonic slot→card mapping guarantees no crossings.
 */
export function computeFanoutRoute(
  source: Point,
  target: Point,
  options?: FanoutOptions,
): OrthogonalRoute {
  const chamferRadius = options?.chamferRadius ?? 0;
  const dy = Math.abs(target.y - source.y);
  const dx = Math.abs(target.x - source.x);

  // Balanced mode: each V-D-V segment gets 1/3 of the vertical distance
  const stubTop = options?.balanced
    ? Math.max(10, dy / 3)
    : (options?.stubTop ?? 15);
  const stubBottom = options?.balanced
    ? Math.max(10, dy / 3)
    : (options?.stubBottom ?? 15);

  const waypoints: Point[] = [source];

  if (dx < 5) {
    // Nearly aligned — straight vertical drop
    waypoints.push(target);
  } else {
    // V-D-V: vertical stub → diagonal → vertical stub
    // Direction-aware: flip stubs when source is below target
    const sourceAbove = source.y < target.y;
    if (sourceAbove) {
      waypoints.push({ x: source.x, y: source.y + stubTop });
      waypoints.push({ x: target.x, y: target.y - stubBottom });
    } else {
      waypoints.push({ x: source.x, y: source.y - stubTop });
      waypoints.push({ x: target.x, y: target.y + stubBottom });
    }
    waypoints.push(target);
  }

  return buildRoute(waypoints, chamferRadius);
}

/**
 * Computes a multi-row orthogonal route for grid layouts where cards
 * span multiple rows below the system board.
 *
 * - Row 0: V(down to channelCenterY + shift) → H(across) → V(down to target)
 * - Row 1+: same V-H-V pattern using the channel zone above the target row
 *
 * `channelOffset × channelSpacing` shifts the horizontal jog so parallel
 * wires from different cards don't overlap.
 */
export function computeMultiRowRoute(
  source: Point,
  target: Point,
  _targetRow: number,
  channelCenterY: number,
  channelOffset: number,
  options?: { channelSpacing?: number; chamferRadius?: number },
): OrthogonalRoute {
  const channelSpacing = options?.channelSpacing ?? 8;
  const chamferRadius = options?.chamferRadius ?? 0;
  const shift = channelOffset * channelSpacing;
  const jogY = channelCenterY + shift;

  const waypoints: Point[] = [source];

  if (Math.abs(source.x - target.x) < 1) {
    // Vertically aligned — straight drop
    waypoints.push(target);
  } else {
    waypoints.push({ x: source.x, y: jogY });
    waypoints.push({ x: target.x, y: jogY });
    waypoints.push(target);
  }

  return buildRoute(waypoints, chamferRadius);
}

/**
 * Replaces each 90° corner in the waypoint list with a 45° chamfer
 * (two points creating a diagonal segment instead of one sharp bend).
 *
 * Chamfer is clamped to half the shorter adjacent segment so that
 * chamfers never overlap on short segments.
 */
function chamferWaypoints(waypoints: Point[], radius: number): Point[] {
  if (waypoints.length <= 2) return waypoints;

  const result: Point[] = [waypoints[0]];

  for (let i = 1; i < waypoints.length - 1; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const next = waypoints[i + 1];

    // Segment lengths
    const lenPrev = Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y);
    const lenNext = Math.abs(next.x - curr.x) + Math.abs(next.y - curr.y);

    // Clamp chamfer to half the shorter adjacent segment
    const maxR = Math.min(lenPrev, lenNext) / 2;
    const r = Math.min(radius, maxR);

    if (r < 1) {
      // Too small to chamfer — keep original point
      result.push(curr);
      continue;
    }

    // Direction from prev → curr (unit vector along axis)
    const dxIn = curr.x - prev.x;
    const dyIn = curr.y - prev.y;
    const lenIn = Math.abs(dxIn) + Math.abs(dyIn);
    const uxIn = lenIn > 0 ? dxIn / lenIn : 0;
    const uyIn = lenIn > 0 ? dyIn / lenIn : 0;

    // Direction from curr → next (unit vector along axis)
    const dxOut = next.x - curr.x;
    const dyOut = next.y - curr.y;
    const lenOut = Math.abs(dxOut) + Math.abs(dyOut);
    const uxOut = lenOut > 0 ? dxOut / lenOut : 0;
    const uyOut = lenOut > 0 ? dyOut / lenOut : 0;

    // Chamfer start: step back from corner along incoming segment
    const chamferStart: Point = {
      x: curr.x - uxIn * r,
      y: curr.y - uyIn * r,
    };

    // Chamfer end: step forward from corner along outgoing segment
    const chamferEnd: Point = {
      x: curr.x + uxOut * r,
      y: curr.y + uyOut * r,
    };

    result.push(chamferStart, chamferEnd);
  }

  result.push(waypoints[waypoints.length - 1]);
  return result;
}

/**
 * Returns bend points for via pad rendering (excludes start/end).
 */
export function getViaPadPositions(waypoints: Point[]): Point[] {
  if (waypoints.length <= 2) return [];
  return waypoints.slice(1, -1);
}

/**
 * Interpolates a position along the orthogonal path at a given fraction (0..1).
 * Used for dot animations that follow the trace path.
 */
export function interpolateAlongOrthogonalPath(
  waypoints: Point[],
  totalLength: number,
  fraction: number,
): Point {
  if (waypoints.length < 2) return waypoints[0] ?? { x: 0, y: 0 };

  const targetDist = fraction * totalLength;
  let accumulated = 0;

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;

    // Use Euclidean distance to handle diagonal (chamfered) segments
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (accumulated + segLen >= targetDist) {
      const remaining = targetDist - accumulated;
      const t = segLen > 0 ? remaining / segLen : 0;
      return { x: prev.x + dx * t, y: prev.y + dy * t };
    }

    accumulated += segLen;
  }

  return waypoints[waypoints.length - 1];
}
