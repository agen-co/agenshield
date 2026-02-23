/**
 * Hook that spawns individual electric "shot" animations on SVG paths.
 *
 * Each shot is a separate DOM `<path>` element created imperatively (no React state).
 * It travels the full wire from source to target, then is removed. Multiple shots
 * overlap for realistic traffic.
 *
 * Zero React re-renders during animation — all DOM manipulation is imperative.
 * anime.js v4 batches all animation instances into a single rAF loop.
 *
 * Supports both timer-driven (automatic) and event-driven (imperative) modes.
 */

import { useRef, useEffect, useCallback, type RefObject } from 'react';
import { animate, type JSAnimation } from 'animejs';
import { canFireShot, incrementGlobal, decrementGlobal } from '../state/shot-registry';

export interface ElectricShotsConfig {
  /** Bright dash length in px */
  pulseWidth: number;
  /** Shot stroke color */
  color: string;
  /** Shot opacity (default 0.85) */
  opacity?: number;
  /** Glow filter URL or undefined */
  filter?: string;
  /** Stroke width multiplier relative to wire width (default 1.5) */
  strokeWidthMultiplier?: number;
  /** Minimum interval between spawns in ms */
  minInterval: number;
  /** Maximum interval between spawns in ms */
  maxInterval: number;
  /** Minimum travel time per shot in ms */
  minDuration: number;
  /** Maximum travel time per shot in ms */
  maxDuration: number;
  /** Max simultaneous shots on this wire */
  maxConcurrent: number;
  /** Whether to use timer-driven spawn loop (default true) */
  timerDriven?: boolean;
}

export interface ElectricShotsHandle {
  /** Imperatively fire a single shot */
  fireShot: () => void;
}

interface ShotState {
  disposed: boolean;
  activeCount: number;
  anims: Set<JSAnimation>;
  timer: ReturnType<typeof setTimeout> | 0;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Spawns individual electric shots that travel a wire path from source to target.
 *
 * @param containerRef - React ref to a `<g>` element inside the edge SVG
 * @param pathD - SVG path `d` attribute string
 * @param totalLength - Pre-computed total path length
 * @param strokeWidth - Base wire stroke width
 * @param config - Shot appearance and timing config (undefined = disabled)
 * @returns Handle with imperative `fireShot()` method
 */
export function useElectricShots(
  containerRef: RefObject<SVGGElement | null>,
  pathD: string,
  totalLength: number,
  strokeWidth: number,
  config: ElectricShotsConfig | undefined,
): ElectricShotsHandle {
  const stateRef = useRef<ShotState | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  // Stable refs for shot spawning parameters
  const pathDRef = useRef(pathD);
  pathDRef.current = pathD;
  const totalLengthRef = useRef(totalLength);
  totalLengthRef.current = totalLength;
  const strokeWidthRef = useRef(strokeWidth);
  strokeWidthRef.current = strokeWidth;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !config || totalLength <= 0 || !pathD) return;

    const {
      pulseWidth,
      color,
      opacity = 0.85,
      filter,
      strokeWidthMultiplier = 1.5,
      minInterval,
      maxInterval,
      minDuration,
      maxDuration,
      maxConcurrent,
      timerDriven = true,
    } = config;

    const shotStrokeWidth = strokeWidth * strokeWidthMultiplier;

    const state: ShotState = {
      disposed: false,
      activeCount: 0,
      anims: new Set(),
      timer: 0,
    };
    stateRef.current = state;

    function spawnSingleShot() {
      if (state.disposed || !container) return;

      // Skip if at local or global capacity
      if (state.activeCount >= maxConcurrent) return;
      if (!canFireShot()) return;

      // Create path element imperatively
      const shotPath = document.createElementNS(SVG_NS, 'path');
      shotPath.setAttribute('d', pathDRef.current);
      shotPath.setAttribute('fill', 'none');
      shotPath.setAttribute('stroke', color);
      shotPath.setAttribute('stroke-width', String(shotStrokeWidth));
      shotPath.setAttribute('stroke-linecap', 'round');
      shotPath.setAttribute('opacity', String(opacity));
      // Exactly ONE visible dash: pulseWidth on, then rest off
      const tl = totalLengthRef.current;
      shotPath.setAttribute('stroke-dasharray', `${pulseWidth} ${tl + pulseWidth}`);
      shotPath.style.pointerEvents = 'none';
      if (filter) shotPath.setAttribute('filter', filter);

      container.appendChild(shotPath);
      state.activeCount++;
      incrementGlobal();

      const duration = randomBetween(minDuration, maxDuration);

      // Animate dash from entering at source to exiting past target
      const anim = animate(shotPath, {
        strokeDashoffset: [tl, -pulseWidth],
        duration,
        ease: 'linear',
      });

      state.anims.add(anim);

      // Clean up when animation completes
      anim.then(() => {
        state.anims.delete(anim);
        state.activeCount--;
        decrementGlobal();
        if (!state.disposed && shotPath.parentNode) {
          shotPath.parentNode.removeChild(shotPath);
        }
      });
    }

    function spawnTimerShot() {
      if (state.disposed || !container) return;

      // Schedule next shot with random interval
      state.timer = setTimeout(spawnTimerShot, randomBetween(minInterval, maxInterval));

      spawnSingleShot();
    }

    // Start the spawn loop only if timer-driven
    if (timerDriven) {
      state.timer = setTimeout(spawnTimerShot, randomBetween(0, minInterval));
    }

    // Cleanup
    return () => {
      state.disposed = true;
      clearTimeout(state.timer);
      state.anims.forEach((a) => a.cancel());
      state.anims.clear();
      // Remove all child shot paths
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      stateRef.current = null;
    };
  }, [
    pathD,
    totalLength,
    config?.pulseWidth,
    config?.color,
    config?.opacity,
    config?.filter,
    config?.strokeWidthMultiplier,
    config?.minInterval,
    config?.maxInterval,
    config?.minDuration,
    config?.maxDuration,
    config?.maxConcurrent,
    config?.timerDriven,
  ]);

  const fireShot = useCallback(() => {
    const state = stateRef.current;
    const container = containerRef.current;
    const cfg = configRef.current;
    if (!state || state.disposed || !container || !cfg) return;
    if (totalLengthRef.current <= 0 || !pathDRef.current) return;

    const {
      pulseWidth,
      color,
      opacity = 0.85,
      filter,
      strokeWidthMultiplier = 1.5,
      minDuration,
      maxDuration,
      maxConcurrent,
    } = cfg;

    if (state.activeCount >= maxConcurrent) return;
    if (!canFireShot()) return;

    const shotStrokeWidth = strokeWidthRef.current * strokeWidthMultiplier;
    const tl = totalLengthRef.current;

    const shotPath = document.createElementNS(SVG_NS, 'path');
    shotPath.setAttribute('d', pathDRef.current);
    shotPath.setAttribute('fill', 'none');
    shotPath.setAttribute('stroke', color);
    shotPath.setAttribute('stroke-width', String(shotStrokeWidth));
    shotPath.setAttribute('stroke-linecap', 'round');
    shotPath.setAttribute('opacity', String(opacity));
    shotPath.setAttribute('stroke-dasharray', `${pulseWidth} ${tl + pulseWidth}`);
    shotPath.style.pointerEvents = 'none';
    if (filter) shotPath.setAttribute('filter', filter);

    container.appendChild(shotPath);
    state.activeCount++;
    incrementGlobal();

    const duration = randomBetween(minDuration, maxDuration);

    const anim = animate(shotPath, {
      strokeDashoffset: [tl, -pulseWidth],
      duration,
      ease: 'linear',
    });

    state.anims.add(anim);

    anim.then(() => {
      state.anims.delete(anim);
      state.activeCount--;
      decrementGlobal();
      if (!state.disposed && shotPath.parentNode) {
        shotPath.parentNode.removeChild(shotPath);
      }
    });
  }, []);

  return { fireShot };
}
