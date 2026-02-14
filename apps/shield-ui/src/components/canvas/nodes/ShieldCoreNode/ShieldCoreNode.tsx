import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Shield } from 'lucide-react';
import { CoreWrapper, CoreIcon, CoreLabel, CoreSub } from './ShieldCoreNode.styles';
import type { ShieldCoreData, CanvasStatus } from '../../Canvas.types';

export const ShieldCoreNode = memo(({ data }: NodeProps) => {
  const { status, version, uptime } = data as unknown as ShieldCoreData;

  const colorMap: Record<CanvasStatus, string> = {
    ok: '#6CB685',
    warning: '#EEA45F',
    error: '#E1583E',
  };

  return (
    <CoreWrapper $status={status}>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <CoreIcon $status={status}>
        <Shield size={24} color={colorMap[status]} />
      </CoreIcon>
      <div>
        <CoreLabel>AgenShield</CoreLabel>
        <CoreSub>v{version} &middot; up {uptime}</CoreSub>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
      <Handle type="target" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
    </CoreWrapper>
  );
});
ShieldCoreNode.displayName = 'ShieldCoreNode';
