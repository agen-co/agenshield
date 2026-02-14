import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap, Shield, KeyRound } from 'lucide-react';
import { StatsRow, StatChip } from './TargetStatsNode.styles';
import type { TargetStatsNodeData } from '../../Canvas.types';

export const TargetStatsNode = memo(({ data }: NodeProps) => {
  const { skillCount, policyCount, secretCount } = data as unknown as TargetStatsNodeData;

  return (
    <StatsRow>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <StatChip>
        <Zap size={12} />
        {skillCount}
      </StatChip>
      <StatChip>
        <Shield size={12} />
        {policyCount}
      </StatChip>
      <StatChip>
        <KeyRound size={12} />
        {secretCount}
      </StatChip>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    </StatsRow>
  );
});
TargetStatsNode.displayName = 'TargetStatsNode';
