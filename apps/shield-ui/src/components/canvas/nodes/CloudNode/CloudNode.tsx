import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Cloud } from 'lucide-react';
import { pcb } from '../../styles/pcb-tokens';
import { PcbChip } from '../shared';
import type { CloudNodeData } from '../../Canvas.types';

export const CloudNode = memo(({ data }: NodeProps) => {
  const { connected } = data as unknown as CloudNodeData;

  const ledColor = connected ? pcb.component.ledGreen : pcb.component.ledOff;

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <PcbChip
        width={100}
        height={60}
        pinsLeft={4}
        pinsRight={4}
        label="AGENCO"
        ledColor={ledColor}
      >
        <div style={{
          position: 'absolute',
          top: 8,
          left: 10,
          display: 'flex',
          alignItems: 'center',
        }}>
          <Cloud size={14} color={connected ? pcb.trace.bright : pcb.trace.dimmed} />
        </div>
      </PcbChip>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
    </div>
  );
});
CloudNode.displayName = 'CloudNode';
