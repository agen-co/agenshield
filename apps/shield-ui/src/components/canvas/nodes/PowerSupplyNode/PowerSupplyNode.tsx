/**
 * PowerSupplyNode — PSU chip above the system board.
 *
 * Uses PcbChip wrapper with Zap icon and a single bottom handle
 * for connecting to the SystemBoard below.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { PcbChip } from '../shared/PcbChip';
import { pcb } from '../../styles/pcb-tokens';
import type { PowerSupplyData } from '../../Canvas.types';

export const PowerSupplyNode = memo(({ data }: NodeProps) => {
  const _psu = data as unknown as PowerSupplyData;

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      {/* Single bottom handle — connects to SystemBoard top */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ visibility: 'hidden' }}
      />

      <PcbChip
        width={120}
        height={70}
        pinsBottom={2}
        pinsTop={0}
        pinsLeft={0}
        pinsRight={0}
        label="PSU"
        sublabel="Power Supply"
        ledColor={pcb.component.ledGreen}
      >
        <Zap
          size={20}
          color={pcb.component.ledAmber}
          style={{ position: 'absolute', top: 6, left: 6 }}
        />
      </PcbChip>
    </div>
  );
});
PowerSupplyNode.displayName = 'PowerSupplyNode';
