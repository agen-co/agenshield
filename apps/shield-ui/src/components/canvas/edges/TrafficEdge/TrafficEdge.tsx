import { memo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { PcbTraceEdge } from '../PcbTraceEdge';

export const TrafficEdge = memo((props: EdgeProps) => {
  const channelOffset = (props.data?.channelOffset as number) ?? 0;
  const showViaPads = (props.data?.showViaPads as boolean) ?? true;

  return (
    <PcbTraceEdge
      {...props}
      config={{
        strokeColor: '#A0A0A0',
        strokeWidth: 2.5,
        showViaPads,
        glowFilter: 'drop-shadow(0 0 3px rgba(160, 160, 160, 0.3))',
        opacity: (props.style?.opacity as number) ?? 1,
        channelOffset,
      }}
    />
  );
});
TrafficEdge.displayName = 'TrafficEdge';
