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
      {/* 3 staggered ambient particle dots */}
      {DOT_OFFSETS.map((delay, i) => (
        <circle key={i} r="3" fill="#6CB685" filter="url(#canvas-glow-green)">
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            path={edgePath}
            begin={`${delay * 2}s`}
          />
        </circle>
      ))}
    </>
  );
});
TrafficEdge.displayName = 'TrafficEdge';
