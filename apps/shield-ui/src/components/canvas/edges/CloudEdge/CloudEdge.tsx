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

const DOT_OFFSETS = [0, 0.5];

/** Memoized dots that only re-render when the SVG path or connected state changes */
const AnimatedDots = memo(
  ({ pathData, id, connected }: { pathData: string; id: string; connected: boolean }) =>
    connected ? (
      <>
        {DOT_OFFSETS.map((delay, i) => (
          <circle key={`${id}-dot-${i}`} r="2.5" fill="#6BAEF2" filter="url(#canvas-glow-blue)">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              path={pathData}
              begin={`${delay * 2.5}s`}
            />
          </circle>
        ))}
      </>
    ) : null,
  (prev, next) => prev.pathData === next.pathData && prev.connected === next.connected,
);
AnimatedDots.displayName = 'CloudAnimatedDots';

export const CloudEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data } = props;
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const connected = Boolean(data?.connected);

  return (
    <>
      <BaseEdge
        {...baseEdgeProps(props)}
        path={edgePath}
        style={{
          stroke: connected ? '#6BAEF2' : '#808080',
          strokeWidth: connected ? 2 : 1.5,
          strokeDasharray: connected ? undefined : '6 4',
          filter: connected ? 'drop-shadow(0 0 2px rgba(107, 174, 242, 0.3))' : undefined,
          opacity: connected ? 1 : 0.4,
        }}
      />
      <AnimatedDots pathData={edgePath} id={props.id} connected={connected} />
    </>
  );
});
CloudEdge.displayName = 'CloudEdge';
