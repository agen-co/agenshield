/**
 * Valtio store for animated dots flowing through the canvas graph.
 */

import { proxy } from 'valtio';
import type { Point } from '../utils/dotInterpolation';

export type DotPhase = 'to-firewall' | 'to-destination';

export interface AnimatedDot {
  id: string;
  phase: DotPhase;
  /** Whether the event was allowed or denied */
  denied: boolean;
  /** Start point (target node center) */
  from: Point;
  /** Current destination (firewall piece center, then computer or denied bucket) */
  to: Point;
  /** Timestamp when the current phase started */
  startTime: number;
  /** Duration of the current phase in ms */
  duration: number;
  /** Firewall piece ID for phase 2 routing */
  firewallId: string;
}

const MAX_DOTS = 10;

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
  newTo: Point,
  duration: number,
) {
  const dot = dotAnimationStore.dots.find((d) => d.id === id);
  if (!dot) return;
  dot.phase = 'to-destination';
  dot.from = { ...dot.to };
  dot.to = newTo;
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
