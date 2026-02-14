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

export const DeniedEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const markerId = `denied-arrow-${props.id}`;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerWidth="10"
          markerHeight="7"
          refX="10"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="#E1583E" />
        </marker>
      </defs>
      <BaseEdge
        {...baseEdgeProps(props)}
        path={edgePath}
        markerEnd={`url(#${markerId})`}
        style={{
          stroke: '#E1583E',
          strokeWidth: 2,
          strokeDasharray: '8 4',
          opacity: 0.8,
          ...(props.style ?? {}),
        }}
      />
    </>
  );
});
DeniedEdge.displayName = 'DeniedEdge';
