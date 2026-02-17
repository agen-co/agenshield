/**
 * ExposedEdge — red-tinted PCB trace for unprotected connections.
 *
 * Used in setup canvas between bus and application cards to show
 * that data flows are unshielded (no firewall, no policy enforcement).
 */

import { memo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { PcbTraceEdge } from '../PcbTraceEdge';

export const ExposedEdge = memo((props: EdgeProps) => {
  const fanout = (props.data?.fanout as boolean) ?? false;
  const channelOffset = (props.data?.channelOffset as number) ?? 0;
  const targetRow = props.data?.targetRow as number | undefined;
  const channelCenterY = props.data?.channelCenterY as number | undefined;
  const channelSpacing = props.data?.channelSpacing as number | undefined;

  return (
    <PcbTraceEdge
      {...props}
      config={{
        strokeColor: '#E1583E',
        strokeWidth: 1.8,
        showViaPads: false,
        glowFilter: 'drop-shadow(0 0 2px rgba(225, 88, 62, 0.2))',
        opacity: (props.style?.opacity as number) ?? 0.45,
        fanout,
        stubTop: 15,
        stubBottom: 15,
        chamferRadius: 10,
        channelOffset,
        targetRow,
        channelCenterY,
        channelSpacing,
      }}
    />
  );
});
ExposedEdge.displayName = 'ExposedEdge';
