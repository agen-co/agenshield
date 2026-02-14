import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

function baseEdgeProps(props: EdgeProps) {
  return {
    id: props.id,
    markerStart: props.markerStart,
    markerEnd: props.markerEnd,
    interactionWidth: props.interactionWidth,
  };
}

const DOT_OFFSETS = [0, 0.33, 0.66];

/** Memoized dots that only re-render when the SVG path changes */
const AnimatedDots = memo(
  ({ pathData, id }: { pathData: string; id: string }) => (
    <>
      {DOT_OFFSETS.map((delay, i) => (
        <circle key={`${id}-dot-${i}`} r="3" fill="#6CB685" filter="url(#canvas-glow-green)">
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            path={pathData}
            begin={`${delay * 2}s`}
          />
        </circle>
      ))}
    </>
  ),
  (prev, next) => prev.pathData === next.pathData,
);
AnimatedDots.displayName = 'TrafficAnimatedDots';

export const TrafficEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

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
      <AnimatedDots pathData={edgePath} id={props.id} />
    </>
  );
});
TrafficEdge.displayName = 'TrafficEdge';
