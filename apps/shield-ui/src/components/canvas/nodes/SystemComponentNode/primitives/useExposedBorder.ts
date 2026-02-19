/**
 * Hook for the pulsing red border shown when a component is exposed.
 * Returns a ref to attach to the border element (rect or path).
 *
 * Generic type parameter allows using with SVGPathElement for
 * non-rectangular chip body shapes (e.g. Network RJ45, Memory DIMM).
 */

import { useRef, useEffect } from 'react';
import { animate, type JSAnimation } from 'animejs';

export function useExposedBorder<T extends SVGElement = SVGRectElement>(exposed: boolean) {
  const ref = useRef<T>(null);
  const animRef = useRef<JSAnimation | null>(null);

  useEffect(() => {
    animRef.current?.cancel();
    animRef.current = null;

    if (exposed && ref.current) {
      animRef.current = animate(ref.current, {
        opacity: [0.15, 0.45],
        duration: 2000,
        ease: 'inOutSine',
        loop: true,
        alternate: true,
      });
    }

    return () => {
      animRef.current?.cancel();
      animRef.current = null;
    };
  }, [exposed]);

  return ref;
}
