/**
 * Valtio store for animated dots flowing through the canvas graph.
 *
 * Dots follow orthogonal waypoint paths instead of straight lines,
 * matching the PCB trace routing of edges.
 */

import { proxy } from 'valtio';
import type { Point } from '../utils/dotInterpolation';

export type DotPhase = 'to-policy' | 'to-firewall' | 'to-destination';

export interface AnimatedDot {
  id: string;
  phase: DotPhase;
  /** Whether the event was allowed or denied */
  denied: boolean;
  /** Waypoints along the orthogonal path (includes start and end) */
  waypoints: Point[];
  /** Total path length for interpolation */
  pathLength: number;
  /** Timestamp when the current phase started */
  startTime: number;
  /** Duration of the current phase in ms */
  duration: number;
  /** Firewall piece ID for phase routing */
  firewallId: string;
  /** Optional color override (default: cyan for allowed, red for denied) */
  color?: string;
}

const MAX_DOTS = 30;

export const dotAnimationStore = proxy({
  dots: [] as AnimatedDot[],
  deniedCount: 0,
});

let dotIdCounter = 0;

export function spawnDot(dot: Omit<AnimatedDot, 'id'>): string {
  const id = `dot-${++dotIdCounter}`;
  // Enforce max concurrent dots
  if (dotAnimationStore.dots.length >= MAX_DOTS) {
    dotAnimationStore.dots.shift();
  }
  dotAnimationStore.dots.push({ ...dot, id });
  return id;
}

export function advanceDot(
  id: string,
  newPhase: DotPhase,
  newWaypoints: Point[],
  newPathLength: number,
  duration: number,
) {
  const dot = dotAnimationStore.dots.find((d) => d.id === id);
  if (!dot) return;
  dot.phase = newPhase;
  dot.waypoints = newWaypoints;
  dot.pathLength = newPathLength;
  dot.startTime = Date.now();
  dot.duration = duration;
}

export function removeDot(id: string) {
  const idx = dotAnimationStore.dots.findIndex((d) => d.id === id);
  if (idx !== -1) dotAnimationStore.dots.splice(idx, 1);
}

export function incrementDenied() {
  dotAnimationStore.deniedCount++;
}
