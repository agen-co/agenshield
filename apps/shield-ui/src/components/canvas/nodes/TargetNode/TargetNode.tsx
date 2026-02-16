import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Globe } from 'lucide-react';
import { useSnapshot } from 'valtio';
import { canvasStore } from '../../state/canvas';
import { pcb } from '../../styles/pcb-tokens';
import { PcbChip } from '../shared';
import type { TargetNodeData } from '../../Canvas.types';

export const TargetNode = memo(({ data }: NodeProps) => {
  const { target } = data as unknown as TargetNodeData;
  const { pulses } = useSnapshot(canvasStore);
  const pulse = pulses[target.id];

  const ledColor = target.shielded ? pcb.component.ledGreen : pcb.component.ledRed;
  // Flash LED on pulse event
  const activeLed = pulse?.severity === 'error'
    ? pcb.component.ledRed
    : pulse?.severity === 'warning'
      ? pcb.component.ledAmber
      : ledColor;

  const sublabel = [
    target.type,
    target.pid ? `PID ${target.pid}` : null,
  ].filter(Boolean).join(' \u00B7 ');

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <PcbChip
        width={140}
        height={70}
        pinsTop={6}
        pinsBottom={6}
        label={target.name}
        sublabel={sublabel}
        ledColor={activeLed}
      >
        <div style={{
          position: 'absolute',
          top: 8,
          left: 10,
          display: 'flex',
          alignItems: 'center',
        }}>
          <Globe size={14} color={target.shielded ? pcb.trace.bright : pcb.trace.dimmed} />
        </div>
      </PcbChip>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    </div>
  );
});
TargetNode.displayName = 'TargetNode';
