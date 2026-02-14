import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Cloud } from 'lucide-react';
import { CloudWrapper, CloudLabel, CloudBadge } from './CloudNode.styles';
import type { CloudNodeData } from '../../Canvas.types';

export const CloudNode = memo(({ data }: NodeProps) => {
  const { connected } = data as unknown as CloudNodeData;

  return (
    <CloudWrapper $connected={connected}>
      <Cloud size={20} color={connected ? '#6BAEF2' : '#808080'} />
      <div>
        <CloudLabel>AgenCo</CloudLabel>
        <CloudBadge $connected={connected}>
          {connected ? 'Connected' : 'Offline'}
        </CloudBadge>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    </CloudWrapper>
  );
});
CloudNode.displayName = 'CloudNode';
