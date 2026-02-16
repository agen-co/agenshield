import { memo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { PcbTraceEdge } from '../PcbTraceEdge';

export const DisconnectedEdge = memo((props: EdgeProps) => {
  const channelOffset = (props.data?.channelOffset as number) ?? 0;

  return (
    <PcbTraceEdge
      {...props}
      config={{
        strokeColor: '#555555',
        strokeWidth: 1.5,
        strokeDasharray: '6 4',
        opacity: 0.3,
        showViaPads: false,
        channelOffset,
      }}
    />
  );
});
DisconnectedEdge.displayName = 'DisconnectedEdge';
