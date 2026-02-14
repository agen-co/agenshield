import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Globe, Shield, FolderLock } from 'lucide-react';
import { FirewallWrapper, FirewallLabel, FirewallSub } from './FirewallPieceNode.styles';
import type { FirewallPieceData } from '../../Canvas.types';

const iconMap: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  network: Globe,
  system: Shield,
  filesystem: FolderLock,
};

export const FirewallPieceNode = memo(({ data }: NodeProps) => {
  const { id, label, sublabel, active } = data as unknown as FirewallPieceData;
  const IconComp = iconMap[id] ?? Shield;
  const iconColor = active ? '#6CB685' : '#808080';

  return (
    <FirewallWrapper $active={active}>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <IconComp size={18} color={iconColor} />
      </div>
      <div>
        <FirewallLabel>{label}</FirewallLabel>
        <FirewallSub>{sublabel}</FirewallSub>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
      <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
    </FirewallWrapper>
  );
});
FirewallPieceNode.displayName = 'FirewallPieceNode';
