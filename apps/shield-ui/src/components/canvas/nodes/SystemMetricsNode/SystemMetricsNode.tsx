import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PcbChip } from '../shared';
import { pcb } from '../../styles/pcb-tokens';
import type { SystemMetricsNodeData } from '../../Canvas.types';

function getLedColor(cpu: number, mem: number, elP99: number): string {
  if (elP99 >= 200) return pcb.component.ledRed;
  const peak = Math.max(cpu, mem);
  if (peak >= 95 || elP99 >= 50) return pcb.component.ledRed;
  if (peak >= 80) return pcb.component.ledAmber;
  return pcb.component.ledGreen;
}

export const SystemMetricsNode = memo(({ data }: NodeProps) => {
  const { cpuPercent, memPercent, eventLoopP99 } = data as unknown as SystemMetricsNodeData;
  const ledColor = getLedColor(cpuPercent, memPercent, eventLoopP99);
  const elLabel = eventLoopP99 >= 1 ? `${Math.round(eventLoopP99)}ms` : '<1ms';

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
      <PcbChip
        width={110}
        height={60}
        pinsLeft={2}
        borderRadius={6}
        label="SYS MON"
        sublabel={`CPU ${cpuPercent}% · MEM ${memPercent}% · EL ${elLabel}`}
        ledColor={ledColor}
      />
    </div>
  );
});
SystemMetricsNode.displayName = 'SystemMetricsNode';
