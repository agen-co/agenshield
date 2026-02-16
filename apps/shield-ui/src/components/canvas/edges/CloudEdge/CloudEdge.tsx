import { memo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { PcbTraceEdge } from '../PcbTraceEdge';

export const CloudEdge = memo((props: EdgeProps) => {
  const connected = Boolean(props.data?.connected);
  const channelOffset = (props.data?.channelOffset as number) ?? 0;

  return (
    <PcbTraceEdge
      {...props}
      config={{
        strokeColor: connected ? '#A0A0A0' : '#555555',
        strokeWidth: connected ? 2 : 1.5,
        strokeDasharray: connected ? undefined : '6 4',
        glowFilter: connected ? 'drop-shadow(0 0 2px rgba(160, 160, 160, 0.3))' : undefined,
        opacity: connected ? 1 : 0.4,
        showViaPads: connected,
        channelOffset,
      }}
    />
  );
});
CloudEdge.displayName = 'CloudEdge';
