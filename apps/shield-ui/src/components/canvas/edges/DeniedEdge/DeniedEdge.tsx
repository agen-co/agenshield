import { memo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { PcbTraceEdge } from '../PcbTraceEdge';

export const DeniedEdge = memo((props: EdgeProps) => {
  const markerId = `denied-arrow-${props.id}`;
  const channelOffset = (props.data?.channelOffset as number) ?? 0;

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
          <polygon points="0 0, 10 3.5, 0 7" fill="#FF1744" />
        </marker>
      </defs>
      <PcbTraceEdge
        {...props}
        markerEnd={`url(#${markerId})`}
        config={{
          strokeColor: '#FF1744',
          strokeWidth: 2,
          strokeDasharray: '4 2',
          opacity: 0.8,
          showViaPads: false,
          channelOffset,
        }}
      />
    </>
  );
});
DeniedEdge.displayName = 'DeniedEdge';
