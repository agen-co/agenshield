import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PcbChip } from '../shared';
import { pcb } from '../../styles/pcb-tokens';
import type { SystemMetricsNodeData } from '../../Canvas.types';

function getLedColor(cpu: number, mem: number): string {
  const peak = Math.max(cpu, mem);
  if (peak >= 95) return pcb.component.ledRed;
  if (peak >= 80) return pcb.component.ledAmber;
  return pcb.component.ledGreen;
}

export const SystemMetricsNode = memo(({ data }: NodeProps) => {
  const { cpuPercent, memPercent } = data as unknown as SystemMetricsNodeData;
  const ledColor = getLedColor(cpuPercent, memPercent);

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
      <PcbChip
        width={90}
        height={60}
        pinsLeft={2}
        borderRadius={6}
        label="SYS MON"
        sublabel={`CPU ${cpuPercent}% · MEM ${memPercent}%`}
        ledColor={ledColor}
      />
    </div>
  );
});
SystemMetricsNode.displayName = 'SystemMetricsNode';
