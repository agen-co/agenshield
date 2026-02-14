import { memo, useRef, useEffect } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

function baseEdgeProps(props: EdgeProps) {
  return {
    id: props.id,
    markerStart: props.markerStart,
    markerEnd: props.markerEnd,
    interactionWidth: props.interactionWidth,
  };
}

export const TrafficEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;

    // Use Web Animations API for the particle motion along the path
    try {
      const anim = el.animate(
        [
          { offsetDistance: '0%', opacity: 0 },
          { offsetDistance: '10%', opacity: 1 },
          { offsetDistance: '90%', opacity: 1 },
          { offsetDistance: '100%', opacity: 0 },
        ],
        {
          duration: 2000,
          iterations: Infinity,
          easing: 'linear',
        },
      );
      return () => anim.cancel();
    } catch {
      // offsetDistance not supported, use SVG animateMotion fallback
    }
  }, [edgePath]);

  return (
    <>
      <BaseEdge
        {...baseEdgeProps(props)}
        path={edgePath}
        style={{
          stroke: '#6CB685',
          strokeWidth: 2,
          filter: 'drop-shadow(0 0 2px rgba(108, 182, 133, 0.3))',
          ...(props.style ?? {}),
        }}
      />
      {/* Animated particle dot using SVG animateMotion */}
      <circle ref={circleRef} r="3" fill="#6CB685" filter="url(#canvas-glow-green)">
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>
    </>
  );
});
TrafficEdge.displayName = 'TrafficEdge';
