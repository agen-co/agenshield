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

export const DisconnectedEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <BaseEdge
      {...baseEdgeProps(props)}
      path={edgePath}
      style={{
        stroke: '#E1583E',
        strokeWidth: 1.5,
        strokeDasharray: '6 4',
        opacity: 0.5,
      }}
    />
  );
});
DisconnectedEdge.displayName = 'DisconnectedEdge';
