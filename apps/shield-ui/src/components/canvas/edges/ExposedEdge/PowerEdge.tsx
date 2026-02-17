/**
 * PowerEdge — gold/amber power trace from PSU to expansion cards.
 *
 * Thinner than data traces, using PCB gold color scheme.
 */

import { memo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { PcbTraceEdge } from '../PcbTraceEdge';

export const PowerEdge = memo((props: EdgeProps) => {
  const channelOffset = (props.data?.channelOffset as number) ?? 0;
  const targetRow = props.data?.targetRow as number | undefined;
  const channelCenterY = props.data?.channelCenterY as number | undefined;
  const channelSpacing = props.data?.channelSpacing as number | undefined;

  return (
    <PcbTraceEdge
      {...props}
      config={{
        strokeColor: '#D4A04A',
        strokeWidth: 1.2,
        showViaPads: false,
        glowFilter: 'drop-shadow(0 0 2px rgba(212, 160, 74, 0.3))',
        opacity: (props.style?.opacity as number) ?? 0.35,
        channelOffset,
        chamferRadius: 10,
        targetRow,
        channelCenterY,
        channelSpacing,
      }}
    />
  );
});
PowerEdge.displayName = 'PowerEdge';
