import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Monitor } from 'lucide-react';
import { ComputerWrapper, ComputerLabel, ComputerSub, LevelBadge } from './ComputerNode.styles';
import type { ComputerNodeData } from '../../Canvas.types';

const levelLabelMap: Record<string, string> = {
  secure: 'Protected',
  partial: 'Partial',
  unprotected: 'Unprotected',
  critical: 'Critical',
};

const levelColorMap: Record<string, string> = {
  secure: '#6CB685',
  partial: '#EEA45F',
  unprotected: '#E1583E',
  critical: '#E1583E',
};

export const ComputerNode = memo(({ data }: NodeProps) => {
  const { currentUser, securityLevel } = data as unknown as ComputerNodeData;

  return (
    <ComputerWrapper $level={securityLevel}>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <Monitor size={22} color={levelColorMap[securityLevel]} />
      </div>
      <div>
        <ComputerLabel>System</ComputerLabel>
        <ComputerSub>{currentUser}</ComputerSub>
        <LevelBadge $level={securityLevel} style={{ marginTop: 4 }}>
          {levelLabelMap[securityLevel]}
        </LevelBadge>
      </div>
    </ComputerWrapper>
  );
});
ComputerNode.displayName = 'ComputerNode';
