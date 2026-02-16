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
  /** SVG d="" string (M, H, V commands only) */
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
  options?: { channelOffset?: number; channelSpacing?: number },
): OrthogonalRoute {
  const channelOffset = options?.channelOffset ?? 0;
  const channelSpacing = options?.channelSpacing ?? 8;
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

  // Build SVG path and compute total length
  let path = `M ${source.x} ${source.y}`;
  let totalLength = 0;

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;

    if (Math.abs(dy) < 0.5) {
      // Horizontal segment
      path += ` H ${curr.x}`;
      totalLength += Math.abs(dx);
    } else if (Math.abs(dx) < 0.5) {
      // Vertical segment
      path += ` V ${curr.y}`;
      totalLength += Math.abs(dy);
    } else {
      // Diagonal fallback (shouldn't happen in orthogonal routing)
      path += ` L ${curr.x} ${curr.y}`;
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }
  }

  return { path, waypoints, totalLength };
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
    const segLen = Math.abs(dx) + Math.abs(dy); // Manhattan distance

    if (accumulated + segLen >= targetDist) {
      const remaining = targetDist - accumulated;
      const t = segLen > 0 ? remaining / segLen : 0;

      // For orthogonal segments, only one of dx/dy is non-zero
      if (Math.abs(dx) > Math.abs(dy)) {
        return { x: prev.x + dx * t, y: prev.y };
      } else {
        return { x: prev.x, y: prev.y + dy * t };
      }
    }

    accumulated += segLen;
  }

  return waypoints[waypoints.length - 1];
}
