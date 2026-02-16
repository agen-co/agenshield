import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PcbChip } from '../shared';
import { pcb } from '../../styles/pcb-tokens';
import type { ControllerNodeData } from '../../Canvas.types';

export const ControllerNode = memo(({ data }: NodeProps) => {
  const { label, sublabel, active } = data as unknown as ControllerNodeData;

  const ledColor = active ? pcb.component.ledGreen : pcb.component.ledOff;

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
      <Handle type="target" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
      <PcbChip
        width={80}
        height={50}
        pinsTop={1}
        pinsLeft={3}
        pinsRight={3}
        borderRadius={10}
        label={label}
        sublabel={sublabel}
        ledColor={ledColor}
      />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    </div>
  );
});
ControllerNode.displayName = 'ControllerNode';
